import { NextResponse } from "next/server";
import { getRepoById, getRepoSettings } from "@/server/data";
import { jsonError, parseNumericParam } from "@/app/api/_lib";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const repoId = parseNumericParam(params.id, "repo id");
    const repo = await getRepoById(repoId);
    if (!repo) {
      return jsonError("Repo not found", 404);
    }

    const settings = await getRepoSettings(repoId);
    return NextResponse.json({ repo, settings });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to load repo", 400);
  }
}
