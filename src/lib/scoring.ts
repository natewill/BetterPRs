import { assert } from "@/lib/assert";
import type { ActiveWeights, ScoreBreakdown } from "@/lib/types";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeFinalScore(
  scoreBreakdown: ScoreBreakdown,
  activeWeights: ActiveWeights,
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [dimension, weight] of Object.entries(activeWeights)) {
    assert(weight >= 0, `Weight must be non-negative for ${dimension}`);
    const score = scoreBreakdown[dimension] ?? 0;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  assert(totalWeight > 0, "Total score weight must be greater than 0");

  // The LLM returns per-dimension scores in 0-10, final score is normalized to 0-100.
  const normalized = (weightedSum / totalWeight) * 10;
  return round(normalized);
}
