import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  authors,
  issues,
  prAiAnalysis,
  prDetailSnapshots,
  prIssueLinks,
  prScores,
  pullRequests,
  refreshRuns,
  repoSettings,
  repos,
} from "@/lib/db/schema";
import { assert } from "@/lib/assert";
import { mergeBotUsers } from "@/lib/bot-users";
import {
  defaultScoreFields,
  parseScopeValuesJson,
  parseScoreFieldConfigsJson,
  parseTypeValuesJson,
  scopeValues,
  timeWindowSchema,
  typeValues,
  type ScoreFieldConfig,
  type TimeWindow,
} from "@/lib/types";

type CreateRepoInput = {
  owner: string;
  name: string;
};

type UpdateRepoSettingsInput = {
  teamMembers: string[];
  botUsers: string[];
  scoreFields: ScoreFieldConfig[];
  scopeValues: string[];
  typeValues: string[];
};

type PrListFilters = {
  window: TimeWindow;
  scope: string | "all";
  type: string | "all";
  includeFiltered: boolean;
  search: string;
};

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length === 0) {
    return true;
  }

  let needleIndex = 0;
  for (const char of haystack) {
    if (char === needle[needleIndex]) {
      needleIndex += 1;
      if (needleIndex === needle.length) {
        return true;
      }
    }
  }

  return false;
}

function fuzzyTitleMatch(title: string, query: string): boolean {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return true;
  }

  const queryTokens = normalizedQuery.split(" ");
  if (queryTokens.every((token) => normalizedTitle.includes(token))) {
    return true;
  }

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const compactTitle = normalizedTitle.replace(/\s+/g, "");
  if (compactQuery.length >= 3 && isSubsequence(compactQuery, compactTitle)) {
    return true;
  }

  return false;
}

function isKnownBotAuthor(login: string, botUsers: string[]): boolean {
  const normalized = login.toLowerCase();
  if (normalized.endsWith("[bot]")) {
    return true;
  }

  const botSet = new Set(botUsers.map((value) => value.toLowerCase()));
  return botSet.has(normalized);
}

function windowStartDate(window: TimeWindow): Date {
  const now = new Date();
  if (window === "today") {
    now.setHours(0, 0, 0, 0);
    return now;
  }
  if (window === "3d") {
    return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  }
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

export async function listTrackedRepos() {
  const db = getDb();
  return db.select().from(repos).orderBy(desc(repos.id));
}

export async function getRepoById(repoId: number) {
  const db = getDb();
  const rows = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
  return rows[0] ?? null;
}

export async function getRepoByOwnerName(owner: string, name: string) {
  const db = getDb();
  const fullName = `${owner}/${name}`;
  const rows = await db.select().from(repos).where(eq(repos.fullName, fullName)).limit(1);
  return rows[0] ?? null;
}

export async function getRepoSettings(repoId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(repoSettings)
    .where(eq(repoSettings.repoId, repoId))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    ...row,
    botUsersJson: mergeBotUsers(row.botUsersJson),
    scopeValuesJson: parseScopeValuesJson(row.scopeValuesJson),
    typeValuesJson: parseTypeValuesJson(row.typeValuesJson),
    activeWeightsJson: parseScoreFieldConfigsJson(row.activeWeightsJson),
  };
}

export async function createTrackedRepo(input: CreateRepoInput) {
  const db = getDb();
  const fullName = `${input.owner}/${input.name}`;

  const existing = await getRepoByOwnerName(input.owner, input.name);
  if (existing) {
    return existing;
  }

  const insertedRepo = await db
    .insert(repos)
    .values({
      owner: input.owner,
      name: input.name,
      fullName,
      isActive: true,
    })
    .returning();

  assert(insertedRepo.length === 1, "Expected exactly one repo insert result");
  const repo = insertedRepo[0];

  await db.insert(repoSettings).values({
    repoId: repo.id,
    teamMembersJson: [],
    botUsersJson: mergeBotUsers([]),
    scopeValuesJson: scopeValues,
    typeValuesJson: typeValues,
    activeWeightsJson: defaultScoreFields,
  });

  return repo;
}

export async function updateTrackedRepoSettings(
  repoId: number,
  input: UpdateRepoSettingsInput,
) {
  const db = getDb();
  const updateResult = await db
    .update(repoSettings)
    .set({
      teamMembersJson: input.teamMembers,
      botUsersJson: mergeBotUsers(input.botUsers),
      scopeValuesJson: parseScopeValuesJson(input.scopeValues),
      typeValuesJson: parseTypeValuesJson(input.typeValues),
      activeWeightsJson: input.scoreFields,
      updatedAt: new Date(),
    })
    .where(eq(repoSettings.repoId, repoId))
    .returning();

  assert(updateResult.length === 1, `Expected repo_settings row for repoId=${repoId}`);
  return updateResult[0];
}

export async function getRankedPrs(repoId: number, filters: PrListFilters) {
  const db = getDb();
  const startDate = windowStartDate(filters.window);

  const conditions = [eq(pullRequests.repoId, repoId), eq(pullRequests.state, "open")];
  conditions.push(gte(pullRequests.createdAt, startDate));

  if (!filters.includeFiltered) {
    conditions.push(eq(pullRequests.filteredOut, false));
  }

  if (filters.scope !== "all") {
    conditions.push(sql`${pullRequests.inferredScopesJson} ? ${filters.scope}`);
  }

  if (filters.type !== "all") {
    conditions.push(sql`${pullRequests.inferredTypesJson} ? ${filters.type}`);
  }

  const rows = await db
    .select({
      pr: pullRequests,
      score: prScores,
      ai: prAiAnalysis,
    })
    .from(pullRequests)
    .leftJoin(prScores, eq(prScores.prId, pullRequests.id))
    .leftJoin(prAiAnalysis, eq(prAiAnalysis.prId, pullRequests.id))
    .where(and(...conditions))
    .orderBy(sql`${prScores.finalScore} desc nulls last`, desc(pullRequests.createdAt));

  if (!filters.search.trim()) {
    return rows;
  }

  return rows.filter((row) => fuzzyTitleMatch(row.pr.title, filters.search));
}

export async function getPrDetail(repoId: number, prNumber: number) {
  const db = getDb();
  const rows = await db
    .select({
      pr: pullRequests,
      score: prScores,
      ai: prAiAnalysis,
      snapshot: prDetailSnapshots,
      author: authors,
    })
    .from(pullRequests)
    .leftJoin(prScores, eq(prScores.prId, pullRequests.id))
    .leftJoin(prAiAnalysis, eq(prAiAnalysis.prId, pullRequests.id))
    .leftJoin(prDetailSnapshots, eq(prDetailSnapshots.prId, pullRequests.id))
    .leftJoin(
      authors,
      and(eq(authors.repoId, pullRequests.repoId), eq(authors.login, pullRequests.authorLogin)),
    )
    .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.githubPrNumber, prNumber)))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const detail = rows[0];
  const settingsRows = await db
    .select({ botUsersJson: repoSettings.botUsersJson })
    .from(repoSettings)
    .where(eq(repoSettings.repoId, repoId))
    .limit(1);
  assert(settingsRows.length === 1, `Expected settings row for repoId=${repoId}`);
  const botUsers = mergeBotUsers(settingsRows[0].botUsersJson);

  const snapshot = detail.snapshot
    ? {
        ...detail.snapshot,
        dataJson: {
          ...detail.snapshot.dataJson,
          prComments: detail.snapshot.dataJson.prComments.filter(
            (comment) => !isKnownBotAuthor(comment.author, botUsers),
          ),
          reviewComments: detail.snapshot.dataJson.reviewComments.filter(
            (comment) => !isKnownBotAuthor(comment.author, botUsers),
          ),
        },
      }
    : null;

  const links = await db
    .select()
    .from(prIssueLinks)
    .where(eq(prIssueLinks.prId, detail.pr.id));

  if (links.length === 0) {
    return { ...detail, snapshot, linkedIssues: [] };
  }

  const issueIds = links.map((row) => row.issueId);
  const linkedIssues = await db
    .select()
    .from(issues)
    .where(inArray(issues.id, issueIds))
    .orderBy(desc(issues.updatedAt));

  return { ...detail, snapshot, linkedIssues };
}

export async function getRefreshStatus(repoId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(refreshRuns)
    .where(eq(refreshRuns.repoId, repoId))
    .orderBy(desc(refreshRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function listRefreshRuns(repoId: number, limit: number) {
  const db = getDb();
  return db
    .select()
    .from(refreshRuns)
    .where(eq(refreshRuns.repoId, repoId))
    .orderBy(desc(refreshRuns.startedAt))
    .limit(limit);
}

export function parseWindow(value: string | null): TimeWindow {
  if (!value) {
    return "today";
  }
  return timeWindowSchema.parse(value);
}

export function parseSearch(value: string | null): string {
  if (!value) {
    return "";
  }
  return value.trim();
}
