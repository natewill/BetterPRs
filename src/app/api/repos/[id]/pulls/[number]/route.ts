import { NextResponse } from "next/server";
import { getPrDetail } from "@/server/data";
import { jsonError, parseNumericParam } from "@/app/api/_lib";

type RouteContext = {
  params: Promise<{ id: string; number: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const repoId = parseNumericParam(params.id, "repo id");
    const prNumber = parseNumericParam(params.number, "pull request number");
    const detail = await getPrDetail(repoId, prNumber);

    if (!detail) {
      return jsonError("Pull request not found", 404);
    }

    return NextResponse.json({ detail });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to load PR detail", 400);
  }
}
