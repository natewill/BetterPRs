import { z } from "zod";
import { NextResponse } from "next/server";
import { getRankedPrs, parseSearch, parseWindow } from "@/server/data";
import { jsonError, parseNumericParam } from "@/app/api/_lib";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const scopeFilterSchema = z.union([z.literal("all"), z.string().min(1)]);
const typeFilterSchema = z.union([z.literal("all"), z.string().min(1)]);

function formatCreatedAt(value: Date): string {
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = monthNames[value.getUTCMonth()];
  const day = value.getUTCDate();
  const year = value.getUTCFullYear();
  const hours24 = value.getUTCHours();
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${month} ${day}, ${year} at ${hours12}:${minutes} ${suffix} UTC`;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const repoId = parseNumericParam(params.id, "repo id");
    const { searchParams } = new URL(request.url);

    const window = parseWindow(searchParams.get("window"));
    const search = parseSearch(searchParams.get("search"));
    const scope = scopeFilterSchema.parse(searchParams.get("scope") ?? "all");
    const type = typeFilterSchema.parse(searchParams.get("type") ?? "all");
    const includeFiltered = searchParams.get("includeFiltered") === "true";

    const pulls = await getRankedPrs(repoId, {
      window,
      scope,
      type,
      includeFiltered,
      search,
    });

    const serializedPulls = pulls.map((row) => ({
      pr: {
        id: row.pr.id,
        githubPrNumber: row.pr.githubPrNumber,
        title: row.pr.title,
        authorLogin: row.pr.authorLogin,
        githubUrl: row.pr.githubUrl,
        inferredScopesJson: row.pr.inferredScopesJson,
        inferredTypesJson: row.pr.inferredTypesJson,
        additions: row.pr.additions,
        deletions: row.pr.deletions,
        changedFiles: row.pr.changedFiles,
        linkedIssueNumbersJson: row.pr.linkedIssueNumbersJson,
        createdAtText: formatCreatedAt(row.pr.createdAt),
      },
      score: row.score
        ? {
            finalScore: row.score.finalScore,
            scoreBreakdownJson: row.score.scoreBreakdownJson,
          }
        : null,
      ai: row.ai ? { beforeOpeningSummary: row.ai.beforeOpeningSummary } : null,
    }));

    return NextResponse.json({ pulls: serializedPulls });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to load pulls", 400);
  }
}
