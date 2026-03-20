import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { updateTrackedRepoSettings } from "@/server/data";
import { jsonError, parseNumericParam, repoSettingsSchema } from "@/app/api/_lib";
import { isAdminAuthConfigured, isAdminRequestAuthorized } from "@/lib/admin-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    if (!isAdminAuthConfigured()) {
      return jsonError("Admin OAuth is not configured on the server", 503);
    }

    if (!isAdminRequestAuthorized(request)) {
      return jsonError("Admin OAuth required", 401);
    }

    const params = await context.params;
    const repoId = parseNumericParam(params.id, "repo id");
    const body = await request.json();
    const parsed = repoSettingsSchema.parse(body);
    const settings = await updateTrackedRepoSettings(repoId, parsed);

    try {
      await tasks.trigger("score-repo-prs", { repoId });
      return NextResponse.json({ settings, scoreRecomputeQueued: true });
    } catch {
      return NextResponse.json({
        settings,
        scoreRecomputeQueued: false,
        warning: "Settings saved, but score recompute could not be queued.",
      });
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to update settings", 400);
  }
}
