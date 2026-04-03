import { GoogleGenAI } from "@google/genai";
import { assert } from "@/lib/assert";
import { getEnv } from "@/lib/env";
import type { LlmAnalysis } from "@/lib/types";
import { llmAnalysisSchema } from "@/lib/types";

export const LLM_PROMPT_VERSION = "v8";
export const LLM_MODEL_NAME = "gemini-3.1-flash-lite-preview";

type AnalyzeInput = {
  title: string;
  body: string;
  linkedIssues: Array<{ title: string; body: string }>;
  changedFilePaths: string[];
  patchExcerpts: string[];
  extractedFacts: Record<string, unknown>;
  scoreFields: Array<{ key: string; prompt: string }>;
  scopeValues: string[];
  typeValues: string[];
};

const LLM_TIMEOUT_MS = 45_000;

function buildResponseJsonSchema(input: AnalyzeInput): unknown {
  const dimensionScoresProperties = Object.fromEntries(
    input.scoreFields.map((field) => [
      field.key,
      {
        type: "number",
        minimum: 0,
        maximum: 10,
      },
    ]),
  );
  const dimensionExplanationsProperties = Object.fromEntries(
    input.scoreFields.map((field) => [
      field.key,
      {
        type: "string",
      },
    ]),
  );

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      beforeOpeningSummary: { type: "string" },
      inferredScope: {
        type: "string",
        enum: input.scopeValues,
      },
      inferredType: {
        type: "string",
        enum: input.typeValues,
      },
      dimensionScores: {
        type: "object",
        additionalProperties: false,
        properties: dimensionScoresProperties,
        required: input.scoreFields.map((field) => field.key),
      },
      dimensionExplanations: {
        type: "object",
        additionalProperties: false,
        properties: dimensionExplanationsProperties,
        required: input.scoreFields.map((field) => field.key),
      },
    },
    required: [
      "beforeOpeningSummary",
      "inferredScope",
      "inferredType",
      "dimensionScores",
      "dimensionExplanations",
    ],
  };
}

function buildPrompt(input: AnalyzeInput): string {
  const dimensionShape = Object.fromEntries(
    input.scoreFields.map((field) => [field.key, 0]),
  );
  const dimensionExplanationShape = Object.fromEntries(
    input.scoreFields.map((field) => [field.key, "string"]),
  );
  const dimensionDefinitionLines = input.scoreFields.map((field) => `- ${field.key}: ${field.prompt}`);

  return [
    "You are a senior open-source maintainer doing PR triage.",
    "Goal: You're tasked with scoring and organizing this PR for other maintainers based on a dimension of weights to decide how worthwhile reviewing this PR will be for other maintainers",
    "The other maintainers are very busy. They don't want you to waste their time.",
    "Be brutally honest. Do not be polite, optimistic, or charitable when evidence is weak.",
    "Call out red flags directly: vague description, missing proof, inflated PRs, risky refactors, unclear impact, Walls of AI written text.",
    "Return JSON only. No markdown.",
    "All dimension scores must be between 0 and 10.",
    "Calibration: 10 exceptional, 8 strong, 6 average, 4 weak, 2 poor, 0 actively harmful/noise.",
    "Use concise output. beforeOpeningSummary must be 1-3 short sentences. Make it an extremely high signal summary that is worthwhile for other maintainers to read",
    "Infer exactly one scope and exactly one type based on the PR description, title, and code.",
    "Use only allowed values for inferredScope and inferredType.",
    "If confidence is low, score lower. Do not invent facts.",
    "For every scoring dimension, return one short explanation for why that dimension got that score.",
    "Dimension explanations should be blunt, concrete, and specific to the evidence in the PR.",
    "",
    `Allowed scope values: ${input.scopeValues.join(", ")}`,
    `Allowed type values: ${input.typeValues.join(", ")}`,
    "",
    "Scoring dimensions:",
    ...dimensionDefinitionLines,
    "",    
    "PR title:",
    input.title,
    "",
    "PR body:",
    input.body,
    "",
    "Linked issues:",
    JSON.stringify(input.linkedIssues),
    "",
    "Changed file paths:",
    JSON.stringify(input.changedFilePaths),
    "",
    "Patch excerpts:",
    JSON.stringify(input.patchExcerpts),
    "",
    "Extracted facts:",
    JSON.stringify(input.extractedFacts),
    "",
    "Return this exact JSON shape:",
    JSON.stringify({
      beforeOpeningSummary: "string",
      inferredScope: input.scopeValues[0] ?? "unknown",
      inferredType: input.typeValues[0] ?? "unknown",
      dimensionScores: dimensionShape,
      dimensionExplanations: dimensionExplanationShape,
    }),
  ].join("\n");
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  assert(start >= 0 && end > start, "LLM response did not contain JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}

function normalizeSingleValueArrays(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };
  if ("inferredScope" in record && !("inferredScopes" in record)) {
    record.inferredScopes = record.inferredScope;
  }
  if ("inferredType" in record && !("inferredTypes" in record)) {
    record.inferredTypes = record.inferredType;
  }
  if (typeof record.inferredScopes === "string") {
    record.inferredScopes = [record.inferredScopes];
  }
  if (typeof record.inferredTypes === "string") {
    record.inferredTypes = [record.inferredTypes];
  }
  return record;
}

export async function analyzeWithLlm(input: AnalyzeInput): Promise<LlmAnalysis> {
  assert(input.scopeValues.length > 0, "scopeValues must not be empty");
  assert(input.typeValues.length > 0, "typeValues must not be empty");

  for (const field of input.scoreFields) {
    assert(field.key.trim().length > 0, "Score field key cannot be empty");
    assert(field.prompt.trim().length > 0, `Score field prompt missing for key=${field.key}`);
  }

  const env = getEnv();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const prompt = buildPrompt(input);
  const responseJsonSchema = buildResponseJsonSchema(input);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await Promise.race([
      ai.models.generateContent({
        model: LLM_MODEL_NAME,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema,
        },
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("LLM request timed out")), LLM_TIMEOUT_MS);
      }),
    ]);

    try {
      const text = response.text ?? "";
      const parsedJson = normalizeSingleValueArrays(parseJsonText(text));
      const analysis = llmAnalysisSchema.parse(parsedJson);

      for (const field of input.scoreFields) {
        const score = analysis.dimensionScores[field.key];
        assert(typeof score === "number", `LLM missing dimension score for key=${field.key}`);
        const explanation = analysis.dimensionExplanations[field.key];
        assert(typeof explanation === "string", `LLM missing dimension explanation for key=${field.key}`);
      }
      assert(
        analysis.inferredScopes.every((value) => input.scopeValues.includes(value)),
        `LLM returned inferredScopes not in allowed list: ${analysis.inferredScopes.join(", ")}`,
      );
      assert(
        analysis.inferredTypes.every((value) => input.typeValues.includes(value)),
        `LLM returned inferredTypes not in allowed list: ${analysis.inferredTypes.join(", ")}`,
      );

      return analysis;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
    }
  }

  throw new Error("LLM analysis failed unexpectedly");
}
