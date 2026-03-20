import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { getRefreshStatus } from "@/server/data";
import { fetchCoreRateLimitStatus } from "@/lib/github";
import { jsonError, parseNumericParam } from "@/app/api/_lib";
import { isAdminAuthConfigured, isAdminRequestAuthorized } from "@/lib/admin-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MANUAL_REFRESH_WINDOW_HOURS = 12;

function formatRateLimitReset(resetAt: Date): string {
  const diffMs = resetAt.getTime() - Date.now();
  const diffMins = Math.max(1, Math.ceil(diffMs / 60_000));
  if (diffMins < 60) {
    return `in about ${diffMins} minute${diffMins === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (mins === 0) {
    return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `in about ${hours}h ${mins}m`;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const repoId = parseNumericParam(params.id, "repo id");
    const status = await getRefreshStatus(repoId);
    return NextResponse.json({ status });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Failed to get refresh status",
      400,
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isAdminAuthConfigured()) {
      return jsonError("Admin OAuth is not configured on the server", 503);
    }

    if (!isAdminRequestAuthorized(request)) {
      return jsonError("Admin OAuth required", 401);
    }

    const params = await context.params;
    const repoId = parseNumericParam(params.id, "repo id");
    const rateLimit = await fetchCoreRateLimitStatus();
    if (rateLimit.remaining <= 0) {
      return jsonError(
        `GitHub token is rate limited. Try again ${formatRateLimitReset(rateLimit.resetAt)}.`,
        429,
      );
    }

    const updatedSinceIso = new Date(
      Date.now() - MANUAL_REFRESH_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const handle = await tasks.trigger("refresh-repo", { repoId, updatedSinceIso });
    return NextResponse.json({ run: handle }, { status: 202 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to enqueue refresh", 400);
  }
}
