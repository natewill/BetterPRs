import { NextResponse } from "next/server";
import { z } from "zod";

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function parseNumericParam(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

export const repoCreateSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
});

export const repoSettingsSchema = z.object({
  teamMembers: z.array(z.string()),
  botUsers: z.array(z.string()),
  scopeValues: z.array(z.string().min(1)).min(1),
  typeValues: z.array(z.string().min(1)).min(1),
  scoreFields: z.array(
    z.object({
      key: z.string().min(1),
      weight: z.number().int().min(0),
      prompt: z.string().min(1),
    }),
  ).min(1),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();

  for (const [index, field] of value.scoreFields.entries()) {
    const key = field.key.trim();
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scoreFields", index, "key"],
        message: `Duplicate score field key: ${key}`,
      });
    }
    seen.add(key);
  }

  if (!value.scoreFields.some((field) => field.weight > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scoreFields"],
      message: "At least one score field must have a weight greater than 0",
    });
  }
});
