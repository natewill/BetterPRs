import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import { assert } from "@/lib/assert";
import { getDb } from "@/lib/db/client";
import {
  authors,
  ignoredPullRequests,
  issues,
  prAiAnalysis,
  prDetailSnapshots,
  prFeatures,
  prIssueLinks,
  prScores,
  pullRequests,
  refreshRuns,
  repoSettings,
  repos,
} from "@/lib/db/schema";
import { extractFeatures, countHumanComments } from "@/lib/features";
import { analyzeWithLlm, LLM_MODEL_NAME, LLM_PROMPT_VERSION } from "@/lib/llm";
import { mergeBotUsers } from "@/lib/bot-users";
import {
  fetchAuthorMergedPrCount,
  fetchIssue,
  fetchOpenPullRequests,
  parseClosingIssueNumbersFromText,
  fetchPullRequest,
  fetchPullRequestFiles,
  fetchPullRequestIssueComments,
  fetchPullRequestReviewComments,
  fetchPullRequestTimeline,
  getPrFullName,
  isPullRequestIssue,
  resolveLinkedIssueNumbersFromPr,
  type GithubPullRequestListItem,
} from "@/lib/github";
import { computeFinalScore } from "@/lib/scoring";
import {
  defaultScoreFields,
  parseScopeValuesJson,
  parseScoreFieldConfigsJson,
  parseTypeValuesJson,
  scopeValues,
  typeValues,
  toActiveWeights,
  type ScoreFieldConfig,
} from "@/lib/types";

type RefreshSummary = {
  processedPrs: number;
  analyzedPrs: number;
  skippedTeamPrs: number;
  fetchedIssues: number;
  failedPrs: number;
  failedAnalyses: number;
  errorSamples: string[];
};

type RefreshSelection =
  | { kind: "all" }
  | { kind: "created_since"; createdSince: Date }
  | { kind: "updated_since"; updatedSince: Date };

type AuthorStats = {
  mergedPrCount: number;
};

const INGEST_CONCURRENCY = 4;
const ANALYZE_TASK_ID = "analyze-pr";
const SCORE_TASK_ID = "score-repo-prs";

function contributorTrustFromMergedPrCount(mergedPrCount: number): number {
  assert(mergedPrCount >= 0, "mergedPrCount must be non-negative");
  if (mergedPrCount >= 5) {
    return 10;
  }
  return 5 + mergedPrCount;
}

function buildAnalysisInputHash(params: {
  modelName: string;
  promptVersion: string;
  contentHash: string;
  linkedIssuePayload: Array<{ title: string; body: string }>;
  dimensionPromptPayload: Array<{ key: string; prompt: string }>;
  scopeValues: string[];
  typeValues: string[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        modelName: params.modelName,
        promptVersion: params.promptVersion,
        contentHash: params.contentHash,
        linkedIssuePayload: params.linkedIssuePayload,
        dimensionPromptPayload: params.dimensionPromptPayload,
        scopeValues: params.scopeValues,
        typeValues: params.typeValues,
      }),
    )
    .digest("hex");
}

function pushRefreshError(summary: RefreshSummary, message: string) {
  if (summary.errorSamples.length < 20) {
    summary.errorSamples.push(message);
  }
}

function isDeterministicScoreField(field: ScoreFieldConfig): boolean {
  return field.key === "contributorTrust";
}

function scoreFromDimensionMap(scores: Record<string, number>, key: string): number {
  return scores[key] ?? 0;
}

function isTeamMember(login: string, teamMembers: string[]): boolean {
  const teamSet = new Set(teamMembers.map((value) => value.toLowerCase()));
  return teamSet.has(login.toLowerCase());
}

function isKnownBot(login: string, bots: string[]): boolean {
  const botSet = new Set(bots.map((value) => value.toLowerCase()));
  return botSet.has(login.toLowerCase()) || login.toLowerCase().endsWith("[bot]");
}

function isGithubNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("GitHub request failed (404)");
}

function isSelectedPr(pr: GithubPullRequestListItem, selection: RefreshSelection): boolean {
  if (selection.kind === "all") {
    return true;
  }

  if (selection.kind === "created_since") {
    return new Date(pr.created_at).getTime() >= selection.createdSince.getTime();
  }

  return new Date(pr.updated_at).getTime() >= selection.updatedSince.getTime();
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  assert(limit > 0, "Concurrency limit must be greater than 0");
  if (items.length === 0) {
    return;
  }

  let index = 0;
  const workerCount = Math.min(limit, items.length);

  async function runWorker() {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) {
        return;
      }

      const item = items[currentIndex];
      assert(item !== undefined, "Missing queued work item");
      await worker(item);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

function toSnapshotComments(
  comments: Awaited<ReturnType<typeof fetchPullRequestIssueComments>>,
) {
  return comments.map((comment) => ({
    id: comment.id,
    author: comment.user.login,
    body: comment.body ?? "",
    createdAt: comment.created_at,
    reactionsCount: comment.reactions?.total_count ?? 0,
  }));
}

function filterBotComments(
  comments: Awaited<ReturnType<typeof fetchPullRequestIssueComments>>,
  botUsers: string[],
) {
  return comments.filter((comment) => !isKnownBot(comment.user.login, botUsers));
}

async function upsertAuthorStats(params: {
  repoId: number;
  authorLogin: string;
  teamMembers: string[];
  botUsers: string[];
  authorStats: AuthorStats;
}) {
  const db = getDb();
  const authorLogin = params.authorLogin;

  await db
    .insert(authors)
    .values({
      repoId: params.repoId,
      login: authorLogin,
      isTeamMember: isTeamMember(authorLogin, params.teamMembers),
      isBot: isKnownBot(authorLogin, params.botUsers),
      mergedPrCount: params.authorStats.mergedPrCount,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [authors.repoId, authors.login],
      set: {
        isTeamMember: isTeamMember(authorLogin, params.teamMembers),
        isBot: isKnownBot(authorLogin, params.botUsers),
        mergedPrCount: params.authorStats.mergedPrCount,
        updatedAt: new Date(),
      },
    });
}

async function upsertPullRequestData(params: {
  repoId: number;
  pr: GithubPullRequestListItem;
  prStats: {
    additions: number;
    deletions: number;
    changedFiles: number;
  };
  linkedIssueNumbers: number[];
  isFilteredOut: boolean;
}) {
  const db = getDb();
  const result = await db
    .insert(pullRequests)
    .values({
      repoId: params.repoId,
      githubPrNumber: params.pr.number,
      title: params.pr.title,
      body: params.pr.body ?? "",
      state: params.pr.state,
      draft: params.pr.draft,
      authorLogin: params.pr.user.login,
      additions: params.prStats.additions,
      deletions: params.prStats.deletions,
      changedFiles: params.prStats.changedFiles,
      createdAt: new Date(params.pr.created_at),
      updatedAt: new Date(params.pr.updated_at),
      githubUrl: params.pr.html_url,
      linkedIssueNumbersJson: params.linkedIssueNumbers,
      inferredScopesJson: ["unknown"],
      inferredTypesJson: ["unknown"],
      filteredOut: params.isFilteredOut,
      filteredReason: params.isFilteredOut ? "team_member" : null,
    })
    .onConflictDoUpdate({
      target: [pullRequests.repoId, pullRequests.githubPrNumber],
      set: {
        title: params.pr.title,
        body: params.pr.body ?? "",
        state: params.pr.state,
        draft: params.pr.draft,
        authorLogin: params.pr.user.login,
        additions: params.prStats.additions,
        deletions: params.prStats.deletions,
        changedFiles: params.prStats.changedFiles,
        updatedAt: new Date(params.pr.updated_at),
        githubUrl: params.pr.html_url,
        linkedIssueNumbersJson: params.linkedIssueNumbers,
        inferredScopesJson: ["unknown"],
        inferredTypesJson: ["unknown"],
        filteredOut: params.isFilteredOut,
        filteredReason: params.isFilteredOut ? "team_member" : null,
      },
    })
    .returning();

  assert(result.length === 1, "Expected single pull request upsert result");
  return result[0];
}

async function upsertIssuesAndLinks(params: {
  repoId: number;
  prId: number;
  repoOwner: string;
  repoName: string;
  linkedIssueNumbers: number[];
}) {
  const db = getDb();
  const linkedIssueRows: typeof issues.$inferSelect[] = [];
  const realLinkedIssueNumbers: number[] = [];
  const existingIssues =
    params.linkedIssueNumbers.length === 0
      ? []
      : await db
          .select()
          .from(issues)
          .where(
            and(
              eq(issues.repoId, params.repoId),
              inArray(issues.githubIssueNumber, params.linkedIssueNumbers),
            ),
          );
  const existingIssueByNumber = new Map(
    existingIssues.map((issue) => [issue.githubIssueNumber, issue] as const),
  );

  for (const issueNumber of params.linkedIssueNumbers) {
    const existingIssue = existingIssueByNumber.get(issueNumber);
    if (existingIssue) {
      linkedIssueRows.push(existingIssue);
      realLinkedIssueNumbers.push(existingIssue.githubIssueNumber);
      continue;
    }

    let issue;
    try {
      issue = await fetchIssue(
        { owner: params.repoOwner, name: params.repoName },
        issueNumber,
      );
    } catch (error) {
      if (isGithubNotFoundError(error)) {
        continue;
      }
      throw error;
    }

    if (isPullRequestIssue(issue)) {
      continue;
    }
    realLinkedIssueNumbers.push(issue.number);

    const issueResult = await db
      .insert(issues)
      .values({
        repoId: params.repoId,
        githubIssueNumber: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        state: issue.state,
        authorLogin: issue.user.login,
        commentsCount: issue.comments,
        reactionsCount: issue.reactions?.total_count ?? 0,
        createdAt: new Date(issue.created_at),
        updatedAt: new Date(issue.updated_at),
        githubUrl: issue.html_url,
      })
      .onConflictDoUpdate({
        target: [issues.repoId, issues.githubIssueNumber],
        set: {
          title: issue.title,
          body: issue.body ?? "",
          state: issue.state,
          authorLogin: issue.user.login,
          commentsCount: issue.comments,
          reactionsCount: issue.reactions?.total_count ?? 0,
          updatedAt: new Date(issue.updated_at),
          githubUrl: issue.html_url,
        },
      })
      .returning();

    assert(issueResult.length === 1, "Expected one issue upsert row");
    linkedIssueRows.push(issueResult[0]);
  }

  await db.delete(prIssueLinks).where(eq(prIssueLinks.prId, params.prId));

  if (linkedIssueRows.length > 0) {
    const uniqueLinkedIssueRows = Array.from(
      new Map(linkedIssueRows.map((issue) => [issue.id, issue] as const)).values(),
    );

    await db
      .insert(prIssueLinks)
      .values(
        uniqueLinkedIssueRows.map((issue) => ({
          prId: params.prId,
          issueId: issue.id,
        })),
      )
      .onConflictDoNothing();
  }

  return {
    linkedIssueRows,
    realLinkedIssueNumbers,
  };
}

async function upsertPrFeatures(params: {
  prId: number;
  linkedIssueCount: number;
  humanPrCommentCount: number;
  humanIssueCommentCount: number;
  prReactionsCount: number;
  issueReactionsCount: number;
  extracted: ReturnType<typeof extractFeatures>;
}) {
  const db = getDb();
  await db
    .insert(prFeatures)
    .values({
      prId: params.prId,
      hasLinkedIssue: params.linkedIssueCount > 0,
      linkedIssueCount: params.linkedIssueCount,
      humanPrCommentCount: params.humanPrCommentCount,
      humanIssueCommentCount: params.humanIssueCommentCount,
      prReactionsCount: params.prReactionsCount,
      issueReactionsCount: params.issueReactionsCount,
      contentHash: params.extracted.contentHash,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [prFeatures.prId],
      set: {
        hasLinkedIssue: params.linkedIssueCount > 0,
        linkedIssueCount: params.linkedIssueCount,
        humanPrCommentCount: params.humanPrCommentCount,
        humanIssueCommentCount: params.humanIssueCommentCount,
        prReactionsCount: params.prReactionsCount,
        issueReactionsCount: params.issueReactionsCount,
        contentHash: params.extracted.contentHash,
        updatedAt: new Date(),
      },
    });
}

async function upsertPrDetailSnapshot(params: {
  prId: number;
  changedFiles: Awaited<ReturnType<typeof fetchPullRequestFiles>>;
  issueComments: Awaited<ReturnType<typeof fetchPullRequestIssueComments>>;
  reviewComments: Awaited<ReturnType<typeof fetchPullRequestReviewComments>>;
  botUsers: string[];
}) {
  const db = getDb();
  const changedFileSnapshot = params.changedFiles.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patchExcerpt: file.patch ? file.patch.slice(0, 1200) : "",
  }));

  const humanIssueComments = filterBotComments(params.issueComments, params.botUsers);
  const humanReviewComments = filterBotComments(params.reviewComments, params.botUsers);

  const snapshotData = {
    prComments: toSnapshotComments(humanIssueComments),
    reviewComments: toSnapshotComments(humanReviewComments),
    changedFiles: changedFileSnapshot,
  };

  await db
    .insert(prDetailSnapshots)
    .values({
      prId: params.prId,
      dataJson: snapshotData,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [prDetailSnapshots.prId],
      set: {
        dataJson: snapshotData,
        updatedAt: new Date(),
      },
    });
}

async function analyzePrInternal(prId: number) {
  const db = getDb();
  const prRows = await db
    .select({
      pr: pullRequests,
      features: prFeatures,
    })
    .from(pullRequests)
    .leftJoin(prFeatures, eq(prFeatures.prId, pullRequests.id))
    .where(eq(pullRequests.id, prId))
    .limit(1);

  assert(prRows.length === 1, `Missing pull request for prId=${prId}`);
  const row = prRows[0];
  assert(row.features, `Missing pr_features row for prId=${prId}`);
  if (row.pr.filteredOut) {
    return { skipped: true };
  }

  const linkedIssueRows = await db
    .select({
      issue: issues,
    })
    .from(prIssueLinks)
    .innerJoin(issues, eq(issues.id, prIssueLinks.issueId))
    .where(eq(prIssueLinks.prId, prId));

  const settingsRows = await db
    .select({
      activeWeightsJson: repoSettings.activeWeightsJson,
      scopeValuesJson: repoSettings.scopeValuesJson,
      typeValuesJson: repoSettings.typeValuesJson,
    })
    .from(repoSettings)
    .where(eq(repoSettings.repoId, row.pr.repoId))
    .limit(1);
  assert(settingsRows.length === 1, `Missing repo settings for repoId=${row.pr.repoId}`);
  const scoreFields = parseScoreFieldConfigsJson(settingsRows[0].activeWeightsJson);
  const inferenceScopeValues = parseScopeValuesJson(settingsRows[0].scopeValuesJson);
  const inferenceTypeValues = parseTypeValuesJson(settingsRows[0].typeValuesJson);
  const llmScoreFields = scoreFields.filter((field) => !isDeterministicScoreField(field));

  const snapshotRows = await db
    .select()
    .from(prDetailSnapshots)
    .where(eq(prDetailSnapshots.prId, prId))
    .limit(1);

  assert(snapshotRows.length === 1, `Missing pr_detail_snapshots row for prId=${prId}`);
  const snapshot = snapshotRows[0];
  const inputHash = buildAnalysisInputHash({
    modelName: LLM_MODEL_NAME,
    promptVersion: LLM_PROMPT_VERSION,
    contentHash: row.features.contentHash,
    linkedIssuePayload: linkedIssueRows.map((item) => ({
      title: item.issue.title,
      body: item.issue.body,
    })),
    dimensionPromptPayload: llmScoreFields.map((field) => ({
      key: field.key,
      prompt: field.prompt,
    })),
    scopeValues: inferenceScopeValues,
    typeValues: inferenceTypeValues,
  });

  const existingAnalysisRows = await db
    .select()
    .from(prAiAnalysis)
    .where(eq(prAiAnalysis.prId, prId))
    .limit(1);

  if (existingAnalysisRows.length === 1 && existingAnalysisRows[0].inputHash === inputHash) {
    return { skipped: true };
  }

  const analysis = await analyzeWithLlm({
    title: row.pr.title,
    body: row.pr.body.slice(0, 6000),
    linkedIssues: linkedIssueRows.map((item) => ({
      title: item.issue.title,
      body: item.issue.body.slice(0, 2000),
    })),
    changedFilePaths: snapshot.dataJson.changedFiles
      .map((file) => file.filename)
      .slice(0, 200),
    patchExcerpts: snapshot.dataJson.changedFiles
      .map((file) => file.patchExcerpt)
      .filter((value) => value.length > 0)
      .map((value) => value.slice(0, 600))
      .slice(0, 4),
    extractedFacts: {
      linkedIssueCount: row.features.linkedIssueCount,
      humanPrCommentCount: row.features.humanPrCommentCount,
      humanIssueCommentCount: row.features.humanIssueCommentCount,
      prReactionsCount: row.features.prReactionsCount,
      issueReactionsCount: row.features.issueReactionsCount,
      draft: row.pr.draft,
      additions: row.pr.additions,
      deletions: row.pr.deletions,
      changedFiles: row.pr.changedFiles,
    },
    scoreFields: llmScoreFields.map((field) => ({
      key: field.key,
      prompt: field.prompt,
    })),
    scopeValues: inferenceScopeValues,
    typeValues: inferenceTypeValues,
  });

  const dimensionScores = analysis.dimensionScores;
  const dimensionExplanations = analysis.dimensionExplanations;

  await db
    .insert(prAiAnalysis)
    .values({
      prId,
      beforeOpeningSummary: analysis.beforeOpeningSummary,
      clarityScore: scoreFromDimensionMap(dimensionScores, "clarity"),
      impactScore: scoreFromDimensionMap(dimensionScores, "impact"),
      urgencyScore: scoreFromDimensionMap(dimensionScores, "urgency"),
      sizeEfficiencyScore: scoreFromDimensionMap(dimensionScores, "sizeEfficiency"),
      contributorTrustScore: scoreFromDimensionMap(dimensionScores, "contributorTrust"),
      communityTractionScore: scoreFromDimensionMap(dimensionScores, "communityTraction"),
      mergeReadinessScore: scoreFromDimensionMap(dimensionScores, "mergeReadiness"),
      guidelineFitScore: scoreFromDimensionMap(dimensionScores, "guidelineFit"),
      dimensionScoresJson: dimensionScores,
      dimensionExplanationsJson: dimensionExplanations,
      modelName: LLM_MODEL_NAME,
      promptVersion: LLM_PROMPT_VERSION,
      inputHash,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [prAiAnalysis.prId],
      set: {
        beforeOpeningSummary: analysis.beforeOpeningSummary,
        clarityScore: scoreFromDimensionMap(dimensionScores, "clarity"),
        impactScore: scoreFromDimensionMap(dimensionScores, "impact"),
        urgencyScore: scoreFromDimensionMap(dimensionScores, "urgency"),
        sizeEfficiencyScore: scoreFromDimensionMap(dimensionScores, "sizeEfficiency"),
        contributorTrustScore: scoreFromDimensionMap(dimensionScores, "contributorTrust"),
        communityTractionScore: scoreFromDimensionMap(dimensionScores, "communityTraction"),
        mergeReadinessScore: scoreFromDimensionMap(dimensionScores, "mergeReadiness"),
        guidelineFitScore: scoreFromDimensionMap(dimensionScores, "guidelineFit"),
        dimensionScoresJson: dimensionScores,
        dimensionExplanationsJson: dimensionExplanations,
        modelName: LLM_MODEL_NAME,
        promptVersion: LLM_PROMPT_VERSION,
        inputHash,
        updatedAt: new Date(),
      },
    });

  await db
    .update(pullRequests)
    .set({
      inferredScopesJson: analysis.inferredScopes,
      inferredTypesJson: analysis.inferredTypes,
    })
    .where(eq(pullRequests.id, prId));

  return { skipped: false };
}

async function scoreRepoPrsInternal(repoId: number) {
  const db = getDb();
  const settingsRows = await db
    .select({ activeWeightsJson: repoSettings.activeWeightsJson })
    .from(repoSettings)
    .where(eq(repoSettings.repoId, repoId))
    .limit(1);
  assert(settingsRows.length === 1, `Missing repo settings for repoId=${repoId}`);
  const scoreFields = parseScoreFieldConfigsJson(settingsRows[0].activeWeightsJson);
  const weights = toActiveWeights(scoreFields);

  const rows = await db
    .select({
      pr: pullRequests,
      ai: prAiAnalysis,
      author: authors,
    })
    .from(pullRequests)
    .leftJoin(prAiAnalysis, eq(prAiAnalysis.prId, pullRequests.id))
    .leftJoin(
      authors,
      and(eq(authors.repoId, pullRequests.repoId), eq(authors.login, pullRequests.authorLogin)),
    )
    .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.state, "open")));

  for (const row of rows) {
    if (row.pr.filteredOut || !row.ai) {
      continue;
    }
    const contributorTrust = contributorTrustFromMergedPrCount(row.author?.mergedPrCount ?? 0);
    const aiDimensionScores: Record<string, number> = {
      impact: row.ai.impactScore,
      sizeEfficiency: row.ai.sizeEfficiencyScore,
      clarity: row.ai.clarityScore,
      urgency: row.ai.urgencyScore,
      contributorTrust: row.ai.contributorTrustScore,
      communityTraction: row.ai.communityTractionScore,
      mergeReadiness: row.ai.mergeReadinessScore,
      guidelineFit: row.ai.guidelineFitScore,
      ...(row.ai.dimensionScoresJson ?? {}),
    };

    const scoreBreakdown: Record<string, number> = {};
    for (const field of scoreFields) {
      if (isDeterministicScoreField(field)) {
        scoreBreakdown[field.key] = contributorTrust;
        continue;
      }
      scoreBreakdown[field.key] = scoreFromDimensionMap(aiDimensionScores, field.key);
    }

    const finalScore = computeFinalScore(scoreBreakdown, weights);

    await db
      .insert(prScores)
      .values({
        prId: row.pr.id,
        finalScore,
        scoreBreakdownJson: scoreBreakdown,
        rankedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [prScores.prId],
        set: {
          finalScore,
          scoreBreakdownJson: scoreBreakdown,
          rankedAt: new Date(),
        },
      });
  }
}

export async function refreshRepoInternal(
  repoId: number,
  selection: RefreshSelection = { kind: "all" },
): Promise<RefreshSummary> {
  const db = getDb();
  const repoRows = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
  assert(repoRows.length === 1, `Missing repo for repoId=${repoId}`);
  const repo = repoRows[0];

  const settingsRows = await db
    .select()
    .from(repoSettings)
    .where(eq(repoSettings.repoId, repoId))
    .limit(1);
  assert(settingsRows.length === 1, `Missing repo settings for repoId=${repoId}`);
  const settings = settingsRows[0];
  const botUsers = mergeBotUsers(settings.botUsersJson);

  const activeRunRows = await db
    .select()
    .from(refreshRuns)
    .where(and(eq(refreshRuns.repoId, repoId), eq(refreshRuns.status, "running")))
    .limit(1);

  if (activeRunRows.length === 1) {
    const activeRun = activeRunRows[0];
    const staleAfterMs = 15 * 60 * 1000;
    const isStale = Date.now() - activeRun.startedAt.getTime() > staleAfterMs;

    if (isStale) {
      await db
        .update(refreshRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          summaryJson: {},
          errorText: "Marked stale by newer refresh request",
        })
        .where(eq(refreshRuns.id, activeRun.id));
    } else {
      return {
        processedPrs: 0,
        analyzedPrs: 0,
        skippedTeamPrs: 0,
        fetchedIssues: 0,
        failedPrs: 0,
        failedAnalyses: 0,
        errorSamples: [],
      };
    }
  }

  const runRows = await db
    .insert(refreshRuns)
    .values({
      repoId,
      status: "running",
      startedAt: new Date(),
      summaryJson: {},
    })
    .returning();
  assert(runRows.length === 1, "Expected refresh run insert row");
  const run = runRows[0];

  const summary: RefreshSummary = {
    processedPrs: 0,
    analyzedPrs: 0,
    skippedTeamPrs: 0,
    fetchedIssues: 0,
    failedPrs: 0,
    failedAnalyses: 0,
    errorSamples: [],
  };

  try {
    const ghRepo = { owner: repo.owner, name: repo.name };
    let openPrs: GithubPullRequestListItem[] = [];
    let isRateLimited = false;

    try {
      openPrs = await fetchOpenPullRequests(ghRepo);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error);
      if (message.includes("rate limit")) {
        isRateLimited = true;
      } else {
        throw error;
      }
    }
    const selectedOpenPrs = openPrs.filter((pr) => isSelectedPr(pr, selection));
    const ignoredRows = await db
      .select({ githubPrNumber: ignoredPullRequests.githubPrNumber })
      .from(ignoredPullRequests)
      .where(eq(ignoredPullRequests.repoId, repoId));
    const ignoredPrNumbers = new Set(ignoredRows.map((row) => row.githubPrNumber));

    if (ignoredRows.length > 0) {
      await db
        .delete(pullRequests)
        .where(
          and(
            eq(pullRequests.repoId, repoId),
            inArray(
              pullRequests.githubPrNumber,
              ignoredRows.map((row) => row.githubPrNumber),
            ),
          ),
        );
    }

    let existingOpenRows = await db
      .select({
        id: pullRequests.id,
        githubPrNumber: pullRequests.githubPrNumber,
        updatedAt: pullRequests.updatedAt,
        filteredOut: pullRequests.filteredOut,
      })
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.state, "open")));

    const githubOpenPrNumbers = new Set(openPrs.map((pr) => pr.number));
    const staleOpenPrNumbers = existingOpenRows
      .filter((row) => !githubOpenPrNumbers.has(row.githubPrNumber))
      .map((row) => row.githubPrNumber);

    if (staleOpenPrNumbers.length > 0) {
      await db
        .delete(pullRequests)
        .where(
          and(
            eq(pullRequests.repoId, repoId),
            inArray(pullRequests.githubPrNumber, staleOpenPrNumbers),
          ),
        );

      existingOpenRows = await db
        .select({
          id: pullRequests.id,
          githubPrNumber: pullRequests.githubPrNumber,
          updatedAt: pullRequests.updatedAt,
          filteredOut: pullRequests.filteredOut,
        })
        .from(pullRequests)
        .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.state, "open")));
    }

    const existingByNumber = new Map(
      existingOpenRows.map((row) => [row.githubPrNumber, row] as const),
    );
    const existingPrIds = existingOpenRows.map((row) => row.id);
    const selectedAuthorLogins = Array.from(
      new Set(selectedOpenPrs.map((pr) => pr.user.login.toLowerCase())),
    );
    const existingAuthorRows =
      selectedAuthorLogins.length === 0
        ? []
        : await db
            .select({
              login: authors.login,
              mergedPrCount: authors.mergedPrCount,
              updatedAt: authors.updatedAt,
            })
            .from(authors)
            .where(and(eq(authors.repoId, repoId), inArray(authors.login, selectedAuthorLogins)));
    const authorStatsByLogin = new Map(
      existingAuthorRows.map((row) => [row.login.toLowerCase(), row] as const),
    );

    const existingAiPrIds = new Set<number>();
    const existingFeaturePrIds = new Set<number>();
    const existingSnapshotPrIds = new Set<number>();

    if (existingPrIds.length > 0) {
      const [aiRows, featureRows, snapshotRows] = await Promise.all([
        db
          .select({ prId: prAiAnalysis.prId })
          .from(prAiAnalysis)
          .where(inArray(prAiAnalysis.prId, existingPrIds)),
        db
          .select({ prId: prFeatures.prId })
          .from(prFeatures)
          .where(inArray(prFeatures.prId, existingPrIds)),
        db
          .select({ prId: prDetailSnapshots.prId })
          .from(prDetailSnapshots)
          .where(inArray(prDetailSnapshots.prId, existingPrIds)),
      ]);

      for (const row of aiRows) {
        existingAiPrIds.add(row.prId);
      }
      for (const row of featureRows) {
        existingFeaturePrIds.add(row.prId);
      }
      for (const row of snapshotRows) {
        existingSnapshotPrIds.add(row.prId);
      }
    }

    const authorStatsCache = new Map<string, Promise<AuthorStats>>();
    const analyzeQueue: number[] = [];

    if (isRateLimited) {
      for (const row of existingOpenRows) {
        if (row.filteredOut) {
          continue;
        }
        if (existingAiPrIds.has(row.id)) {
          continue;
        }
        if (!existingFeaturePrIds.has(row.id) || !existingSnapshotPrIds.has(row.id)) {
          continue;
        }
        analyzeQueue.push(row.id);
      }
    }

    async function getAuthorStats(authorLogin: string): Promise<AuthorStats> {
      const cacheKey = authorLogin.toLowerCase();
      const cached = authorStatsCache.get(cacheKey);
      if (cached) {
        return cached;
      }
      const existingAuthor = authorStatsByLogin.get(cacheKey);

      const promise = (async () => {
        try {
          const mergedPrCount = await fetchAuthorMergedPrCount(
            { owner: repo.owner, name: repo.name },
            authorLogin,
          );
          authorStatsByLogin.set(cacheKey, {
            login: authorLogin,
            mergedPrCount,
            updatedAt: new Date(),
          });
          return {
            mergedPrCount,
          };
        } catch (error) {
          if (existingAuthor) {
            return {
              mergedPrCount: existingAuthor.mergedPrCount,
            };
          }
          throw error;
        }
      })();

      authorStatsCache.set(cacheKey, promise);
      return promise;
    }

    if (selectedOpenPrs.length > 0) {
      await runWithConcurrency(selectedOpenPrs, INGEST_CONCURRENCY, async (pr) => {
        try {
          if (ignoredPrNumbers.has(pr.number)) {
            return;
          }
          summary.processedPrs += 1;
          const filteredOut = isTeamMember(pr.user.login, settings.teamMembersJson);
          if (filteredOut) {
            summary.skippedTeamPrs += 1;
          }

          const existing = existingByNumber.get(pr.number);
          const ghUpdatedAt = new Date(pr.updated_at);
          const unchanged = existing && existing.updatedAt.getTime() === ghUpdatedAt.getTime();

          if (unchanged) {
            assert(existing, "Expected existing pull request row");
            if (existing.filteredOut !== filteredOut) {
              await db
                .update(pullRequests)
                .set({
                  filteredOut,
                  filteredReason: filteredOut ? "team_member" : null,
                })
                .where(eq(pullRequests.id, existing.id));
            }

            if (filteredOut) {
              return;
            }
            const authorStats = await getAuthorStats(pr.user.login);
            await upsertAuthorStats({
              repoId,
              authorLogin: pr.user.login,
              teamMembers: settings.teamMembersJson,
              botUsers,
              authorStats,
            });

            if (
              !existingAiPrIds.has(existing.id) &&
              existingFeaturePrIds.has(existing.id) &&
              existingSnapshotPrIds.has(existing.id)
            ) {
              analyzeQueue.push(existing.id);
            }

            return;
          }

          const bodyLinkedIssueNumbers = parseClosingIssueNumbersFromText(pr.body ?? "");
          const timelineEventsPromise =
            bodyLinkedIssueNumbers.length > 0
              ? Promise.resolve([])
              : fetchPullRequestTimeline(ghRepo, pr.number);
          const [
            prDetail,
            changedFiles,
            issueComments,
            reviewComments,
            timelineEvents,
            authorStats,
          ] = await Promise.all([
            fetchPullRequest(ghRepo, pr.number),
            fetchPullRequestFiles(ghRepo, pr.number),
            fetchPullRequestIssueComments(ghRepo, pr.number),
            fetchPullRequestReviewComments(ghRepo, pr.number),
            timelineEventsPromise,
            getAuthorStats(pr.user.login),
          ]);

          const linkedIssueNumbers = resolveLinkedIssueNumbersFromPr(pr, timelineEvents);
          const extracted = extractFeatures({ pr, changedFiles });
          const authorLogin = pr.user.login;

          const prRow = await upsertPullRequestData({
            repoId,
            pr,
            prStats: {
              additions: prDetail.additions,
              deletions: prDetail.deletions,
              changedFiles: prDetail.changed_files,
            },
            linkedIssueNumbers,
            isFilteredOut: filteredOut,
          });

          await upsertAuthorStats({
            repoId,
            authorLogin,
            teamMembers: settings.teamMembersJson,
            botUsers,
            authorStats,
          });

          const issueUpsert = await upsertIssuesAndLinks({
            repoId,
            prId: prRow.id,
            repoOwner: repo.owner,
            repoName: repo.name,
            linkedIssueNumbers,
          });
          summary.fetchedIssues += issueUpsert.linkedIssueRows.length;

          await db
            .update(pullRequests)
            .set({
              linkedIssueNumbersJson: issueUpsert.realLinkedIssueNumbers,
            })
            .where(eq(pullRequests.id, prRow.id));

          await upsertPrFeatures({
            prId: prRow.id,
            linkedIssueCount: issueUpsert.realLinkedIssueNumbers.length,
            humanPrCommentCount: countHumanComments(issueComments, botUsers),
            humanIssueCommentCount: issueUpsert.linkedIssueRows.reduce(
              (sum, issueRow) => sum + issueRow.commentsCount,
              0,
            ),
            prReactionsCount: issueComments.reduce(
              (sum, comment) => sum + (comment.reactions?.total_count ?? 0),
              0,
            ),
            issueReactionsCount: issueUpsert.linkedIssueRows.reduce(
              (sum, issueRow) => sum + issueRow.reactionsCount,
              0,
            ),
            extracted,
          });

          await upsertPrDetailSnapshot({
            prId: prRow.id,
            changedFiles,
            issueComments,
            reviewComments,
            botUsers,
          });

          if (!filteredOut) {
            analyzeQueue.push(prRow.id);
          }
        } catch (error) {
          summary.failedPrs += 1;
          pushRefreshError(
            summary,
            `pr #${pr.number}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    }

    const queuedPrIds = Array.from(new Set(analyzeQueue));
    if (queuedPrIds.length > 0) {
      const analysisBatch = await tasks.batchTriggerAndWait(
        ANALYZE_TASK_ID,
        queuedPrIds.map((prId) => ({
          payload: { prId },
        })),
      );

      for (const [index, analysisRun] of analysisBatch.runs.entries()) {
        const prId = queuedPrIds[index];
        assert(prId !== undefined, "Missing analyze queue prId");
        if (!analysisRun.ok) {
          summary.failedAnalyses += 1;
          pushRefreshError(summary, `analyze prId=${prId} failed`);
          continue;
        }
        if (!analysisRun.output.skipped) {
          summary.analyzedPrs += 1;
        }
      }
    }

    const scoreRun = await tasks.triggerAndWait(SCORE_TASK_ID, { repoId });
    if (!scoreRun.ok) {
      throw new Error(`score-repo-prs failed for repoId=${repoId}`);
    }

    await db
      .update(repos)
      .set({ lastRefreshedAt: new Date(), updatedAt: new Date() })
      .where(eq(repos.id, repoId));

    await db
      .update(refreshRuns)
      .set({
        status: "completed",
        finishedAt: new Date(),
        summaryJson: summary as Record<string, unknown>,
        errorText: null,
      })
      .where(eq(refreshRuns.id, run.id));

    return summary;
  } catch (error) {
    await db
      .update(refreshRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        summaryJson: summary as Record<string, unknown>,
        errorText: error instanceof Error ? error.message : String(error),
      })
      .where(eq(refreshRuns.id, run.id));
    throw error;
  }
}

export async function refreshActiveReposInternal() {
  const db = getDb();
  const activeRepos = await db.select().from(repos).where(eq(repos.isActive, true));
  const updatedSinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  for (const repo of activeRepos) {
    await tasks.trigger("refresh-repo", { repoId: repo.id, updatedSinceIso });
  }

  return { queued: activeRepos.length };
}

export async function scoreRepoPrsByRepoId(repoId: number) {
  await scoreRepoPrsInternal(repoId);
}

export async function analyzePrById(prId: number) {
  return analyzePrInternal(prId);
}

export async function upsertRepoFromFullName(fullName: string) {
  const db = getDb();
  const [owner, name] = fullName.split("/");
  assert(owner && name, `Invalid full repo name: ${fullName}`);

  const rows = await db
    .insert(repos)
    .values({
      owner,
      name,
      fullName,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [repos.fullName],
      set: {
        owner,
        name,
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning();

  const repo = rows[0];
  assert(repo, "Failed to upsert repo");

  const settingsRows = await db
    .select()
    .from(repoSettings)
    .where(eq(repoSettings.repoId, repo.id))
    .limit(1);

  if (settingsRows.length === 0) {
    await db.insert(repoSettings).values({
      repoId: repo.id,
      teamMembersJson: [],
      botUsersJson: mergeBotUsers([]),
      scopeValuesJson: scopeValues,
      typeValuesJson: typeValues,
      activeWeightsJson: defaultScoreFields,
    });
  }

  return repo;
}

export async function seedDefaultRepo() {
  return upsertRepoFromFullName("anomalyco/opencode");
}

export function inferRepoFromPr(pr: GithubPullRequestListItem) {
  const fullName = getPrFullName(pr);
  const [owner, name] = fullName.split("/");
  assert(owner && name, `Invalid repo full name in PR payload: ${fullName}`);
  return { owner, name };
}

export async function recomputeScoresForRepo(repoId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.state, "open")));
  const prIds = rows.map((row) => row.id);
  if (prIds.length === 0) {
    return;
  }

  const analyses = await db
    .select()
    .from(prAiAnalysis)
    .where(inArray(prAiAnalysis.prId, prIds));

  if (analyses.length === 0) {
    return;
  }

  await scoreRepoPrsInternal(repoId);
}
