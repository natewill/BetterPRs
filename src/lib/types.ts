import { assert } from "@/lib/assert";
import { z } from "zod";

export const scopeValues = ["app", "desktop", "opencode", "tui", "zen", "unknown"];

export const typeValues = ["fix", "feat", "docs", "chore", "refactor", "test", "bug", "unknown"];

export const timeWindowValues = ["today", "3d", "7d"] as const;

export type Scope = string;
export type PrType = string;
export type TimeWindow = (typeof timeWindowValues)[number];

export type ActiveWeights = Record<string, number>;
export type ScoreBreakdown = Record<string, number>;
export type ScoreExplanations = Record<string, string>;

export type ScoreFieldConfig = {
  key: string;
  weight: number;
  prompt: string;
};

export type RepoInferenceConfig = {
  scopeValues: string[];
  typeValues: string[];
};

const defaultPrompts: Record<string, string> = {
  impact: "Score real maintainer/user impact if merged soon. Reward concrete user-facing fixes and meaningful unblockers.",
  sizeEfficiency:
    "Score value delivered for the size of the change. Strictly penalize large diffs for this dimension.",
  clarity:
    "Score how clear and concrete the PR is. Reward precise problem statement, rationale, and verification.",
  urgency:
    "Score time sensitivity and severity if delayed. Reward regressions, breakages, and active pain.",
  contributorTrust:
    "This field is deterministic in the app from merged PR count and should not be model-scored.",
  communityTraction:
    "Score signals that the community cares: discussion depth, reactions, and linked issue relevance.",
  mergeReadiness:
    "Score how close this PR appears to safe merge now, based on scope focus and obvious risk.",
  guidelineFit:
    "Score adherence to contribution quality norms: focused scope, coherent title/body, and verification quality.",
};

export const defaultScoreFields: ScoreFieldConfig[] = [
  { key: "impact", weight: 22, prompt: defaultPrompts.impact },
  {
    key: "sizeEfficiency",
    weight: 18,
    prompt: defaultPrompts.sizeEfficiency,
  },
  { key: "clarity", weight: 15, prompt: defaultPrompts.clarity },
  { key: "urgency", weight: 12, prompt: defaultPrompts.urgency },
  {
    key: "contributorTrust",
    weight: 8,
    prompt: defaultPrompts.contributorTrust,
  },
  {
    key: "communityTraction",
    weight: 8,
    prompt: defaultPrompts.communityTraction,
  },
  {
    key: "mergeReadiness",
    weight: 12,
    prompt: defaultPrompts.mergeReadiness,
  },
  {
    key: "guidelineFit",
    weight: 5,
    prompt: defaultPrompts.guidelineFit,
  },
];

export const scopeSchema = z.string().min(1);
export const prTypeSchema = z.string().min(1);
export const timeWindowSchema = z.enum(timeWindowValues);

const scoreFieldConfigSchema = z.object({
  key: z.string().min(1),
  weight: z.number().int().min(0),
  prompt: z.string().min(1),
});
const legacyScoreFieldConfigSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().int().min(0),
  prompt: z.string().min(1),
});

const scoreFieldConfigsSchema = z.array(scoreFieldConfigSchema).min(1);
const legacyActiveWeightsSchema = z.record(z.string(), z.number().int().min(0));
const optionValuesSchema = z.array(z.string().min(1)).min(1);

export const activeWeightsSchema = z.record(z.string(), z.number().int().min(0));
export const scoreBreakdownSchema = z.record(z.string(), z.number().min(0).max(10));
export const scoreExplanationsSchema = z.record(z.string(), z.string().min(1));
const inferredValuesSchema = z
  .union([z.string().min(1), z.array(z.string().min(1)).length(1)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

export const llmAnalysisSchema = z.object({
  beforeOpeningSummary: z.string().min(1),
  inferredScopes: inferredValuesSchema,
  inferredTypes: inferredValuesSchema,
  dimensionScores: z.record(z.string(), z.number().min(0).max(10)),
  dimensionExplanations: scoreExplanationsSchema,
});

export type LlmAnalysis = z.infer<typeof llmAnalysisSchema>;

function normalizeScoreFieldConfig(input: ScoreFieldConfig): ScoreFieldConfig {
  const key = input.key.trim();
  const prompt = input.prompt.trim();

  assert(key.length > 0, "Score field key cannot be empty");
  assert(prompt.length > 0, `Score field prompt cannot be empty for key=${key}`);

  return {
    key,
    weight: input.weight,
    prompt,
  };
}

function assertUniqueScoreFieldKeys(scoreFields: ScoreFieldConfig[]) {
  const seen = new Set<string>();

  for (const field of scoreFields) {
    assert(!seen.has(field.key), `Duplicate score field key: ${field.key}`);
    seen.add(field.key);
  }
}

function toDefaultScoreFieldConfig(key: string, weight: number): ScoreFieldConfig {
  return {
    key,
    weight,
    prompt:
      defaultPrompts[key] ??
      "Score this dimension strictly from concrete evidence in the PR context.",
  };
}

export function parseScoreFieldConfigsJson(value: unknown): ScoreFieldConfig[] {
  if (Array.isArray(value)) {
    const parsed = z
      .array(z.union([scoreFieldConfigSchema, legacyScoreFieldConfigSchema]))
      .min(1)
      .parse(value)
      .map((field) =>
        normalizeScoreFieldConfig({
          key: field.key,
          weight: field.weight,
          prompt: field.prompt,
        }),
      );
    assertUniqueScoreFieldKeys(parsed);
    assert(parsed.length > 0, "At least one score field is required");
    return parsed;
  }

  const legacy = legacyActiveWeightsSchema.parse(value);
  const keys = Object.keys(legacy);
  if (keys.length === 0) {
    return defaultScoreFields;
  }

  return keys.map((key) => toDefaultScoreFieldConfig(key, legacy[key] ?? 0));
}

export function toActiveWeights(scoreFields: ScoreFieldConfig[]): ActiveWeights {
  const normalized = scoreFieldConfigsSchema.parse(scoreFields).map(normalizeScoreFieldConfig);
  assertUniqueScoreFieldKeys(normalized);
  const weights: ActiveWeights = {};

  for (const field of normalized) {
    weights[field.key] = field.weight;
  }

  return weights;
}

function normalizeOptionValues(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }

  assert(normalized.length > 0, "At least one option is required");
  return normalized;
}

export function parseScopeValuesJson(value: unknown): string[] {
  if (value === undefined || value === null) {
    return scopeValues;
  }
  if (Array.isArray(value) && value.length === 0) {
    return scopeValues;
  }
  return normalizeOptionValues(optionValuesSchema.parse(value));
}

export function parseTypeValuesJson(value: unknown): string[] {
  if (value === undefined || value === null) {
    return typeValues;
  }
  if (Array.isArray(value) && value.length === 0) {
    return typeValues;
  }
  return normalizeOptionValues(optionValuesSchema.parse(value));
}
