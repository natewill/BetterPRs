import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
  doublePrecision,
} from "drizzle-orm/pg-core";
import type { ScoreBreakdown, ScoreExplanations, ScoreFieldConfig } from "@/lib/types";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const repos = pgTable(
  "repos",
  {
    id: serial("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    uniqueFullName: uniqueIndex("repos_full_name_unique").on(table.fullName),
  }),
);

export const repoSettings = pgTable(
  "repo_settings",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    teamMembersJson: jsonb("team_members_json").$type<string[]>().notNull().default([]),
    botUsersJson: jsonb("bot_users_json").$type<string[]>().notNull().default([]),
    scopeValuesJson: jsonb("scope_values_json").$type<string[]>().notNull().default([]),
    typeValuesJson: jsonb("type_values_json").$type<string[]>().notNull().default([]),
    activeWeightsJson: jsonb("active_weights_json")
      .$type<ScoreFieldConfig[]>()
      .notNull(),
    ...timestamps,
  },
  (table) => ({
    uniqueRepoSettings: uniqueIndex("repo_settings_repo_id_unique").on(table.repoId),
  }),
);

export const authors = pgTable(
  "authors",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    login: text("login").notNull(),
    isTeamMember: boolean("is_team_member").notNull().default(false),
    isBot: boolean("is_bot").notNull().default(false),
    mergedPrCount: integer("merged_pr_count").notNull().default(0),
    ...timestamps,
  },
  (table) => ({
    uniqueAuthorPerRepo: uniqueIndex("authors_repo_login_unique").on(table.repoId, table.login),
  }),
);

export const issues = pgTable(
  "issues",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    githubIssueNumber: integer("github_issue_number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    state: text("state").notNull(),
    authorLogin: text("author_login").notNull(),
    commentsCount: integer("comments_count").notNull().default(0),
    reactionsCount: integer("reactions_count").notNull().default(0),
    githubUrl: text("github_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    uniqueIssuePerRepo: uniqueIndex("issues_repo_issue_number_unique").on(
      table.repoId,
      table.githubIssueNumber,
    ),
  }),
);

export const pullRequests = pgTable(
  "pull_requests",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    githubPrNumber: integer("github_pr_number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    state: text("state").notNull(),
    draft: boolean("draft").notNull().default(false),
    authorLogin: text("author_login").notNull(),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    changedFiles: integer("changed_files").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    githubUrl: text("github_url").notNull(),
    linkedIssueNumbersJson: jsonb("linked_issue_numbers_json")
      .$type<number[]>()
      .notNull()
      .default([]),
    inferredScopesJson: jsonb("inferred_scopes_json").$type<string[]>().notNull().default([]),
    inferredTypesJson: jsonb("inferred_types_json").$type<string[]>().notNull().default([]),
    filteredOut: boolean("filtered_out").notNull().default(false),
    filteredReason: text("filtered_reason"),
  },
  (table) => ({
    uniquePrPerRepo: uniqueIndex("pull_requests_repo_pr_number_unique").on(
      table.repoId,
      table.githubPrNumber,
    ),
    repoUpdatedIndex: index("pull_requests_repo_updated_at_idx").on(table.repoId, table.updatedAt),
  }),
);

export const ignoredPullRequests = pgTable(
  "ignored_pull_requests",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    githubPrNumber: integer("github_pr_number").notNull(),
    reason: text("reason").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueIgnoredPrPerRepo: uniqueIndex("ignored_pull_requests_repo_pr_number_unique").on(
      table.repoId,
      table.githubPrNumber,
    ),
  }),
);

export const prIssueLinks = pgTable(
  "pr_issue_links",
  {
    id: serial("id").primaryKey(),
    prId: integer("pr_id")
      .notNull()
      .references(() => pullRequests.id, { onDelete: "cascade" }),
    issueId: integer("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
  },
  (table) => ({
    uniquePrIssueLink: uniqueIndex("pr_issue_links_pr_issue_unique").on(
      table.prId,
      table.issueId,
    ),
  }),
);

export const prFeatures = pgTable(
  "pr_features",
  {
    id: serial("id").primaryKey(),
    prId: integer("pr_id")
      .notNull()
      .references(() => pullRequests.id, { onDelete: "cascade" }),
    hasLinkedIssue: boolean("has_linked_issue").notNull().default(false),
    linkedIssueCount: integer("linked_issue_count").notNull().default(0),
    humanPrCommentCount: integer("human_pr_comment_count").notNull().default(0),
    humanIssueCommentCount: integer("human_issue_comment_count").notNull().default(0),
    prReactionsCount: integer("pr_reactions_count").notNull().default(0),
    issueReactionsCount: integer("issue_reactions_count").notNull().default(0),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniquePrFeatures: uniqueIndex("pr_features_pr_id_unique").on(table.prId),
  }),
);

export const prAiAnalysis = pgTable(
  "pr_ai_analysis",
  {
    id: serial("id").primaryKey(),
    prId: integer("pr_id")
      .notNull()
      .references(() => pullRequests.id, { onDelete: "cascade" }),
    beforeOpeningSummary: text("before_opening_summary").notNull(),
    clarityScore: doublePrecision("clarity_score").notNull(),
    impactScore: doublePrecision("impact_score").notNull(),
    urgencyScore: doublePrecision("urgency_score").notNull(),
    sizeEfficiencyScore: doublePrecision("size_efficiency_score").notNull(),
    contributorTrustScore: doublePrecision("contributor_trust_score").notNull().default(0),
    communityTractionScore: doublePrecision("community_traction_score").notNull().default(0),
    mergeReadinessScore: doublePrecision("merge_readiness_score").notNull().default(0),
    guidelineFitScore: doublePrecision("guideline_fit_score").notNull().default(0),
    dimensionScoresJson: jsonb("dimension_scores_json").$type<Record<string, number>>().notNull().default({}),
    dimensionExplanationsJson: jsonb("dimension_explanations_json")
      .$type<ScoreExplanations>()
      .notNull()
      .default({}),
    modelName: text("model_name").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniquePrAiAnalysis: uniqueIndex("pr_ai_analysis_pr_id_unique").on(table.prId),
  }),
);

export const prScores = pgTable(
  "pr_scores",
  {
    id: serial("id").primaryKey(),
    prId: integer("pr_id")
      .notNull()
      .references(() => pullRequests.id, { onDelete: "cascade" }),
    finalScore: doublePrecision("final_score").notNull().default(0),
    scoreBreakdownJson: jsonb("score_breakdown_json").$type<ScoreBreakdown>().notNull(),
    rankedAt: timestamp("ranked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniquePrScore: uniqueIndex("pr_scores_pr_id_unique").on(table.prId),
  }),
);

export const refreshRuns = pgTable("refresh_runs", {
  id: serial("id").primaryKey(),
  repoId: integer("repo_id")
    .notNull()
    .references(() => repos.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  summaryJson: jsonb("summary_json").$type<Record<string, unknown>>().notNull().default({}),
  errorText: text("error_text"),
});

export type SnapshotComment = {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  reactionsCount: number;
};

export type SnapshotChangedFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patchExcerpt: string;
};

export type PrDetailSnapshot = {
  prComments: SnapshotComment[];
  reviewComments: SnapshotComment[];
  changedFiles: SnapshotChangedFile[];
};

export const prDetailSnapshots = pgTable(
  "pr_detail_snapshots",
  {
    id: serial("id").primaryKey(),
    prId: integer("pr_id")
      .notNull()
      .references(() => pullRequests.id, { onDelete: "cascade" }),
    dataJson: jsonb("data_json").$type<PrDetailSnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniquePrDetailSnapshot: uniqueIndex("pr_detail_snapshots_pr_id_unique").on(table.prId),
  }),
);
