import { NextResponse } from "next/server";
import { jsonError } from "@/app/api/_lib";
import {
  ADMIN_OAUTH_NEXT_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  adminCookieAges,
  buildGithubOauthUrl,
  createOauthState,
  isAdminAuthConfigured,
  oauthCookieOptions,
  sanitizeNextPath,
} from "@/lib/admin-auth";

export async function GET(request: Request) {
  try {
    if (!isAdminAuthConfigured()) {
      return jsonError("Admin OAuth is not configured on the server", 503);
    }

    const url = new URL(request.url);
    const nextPath = sanitizeNextPath(url.searchParams.get("next"));
    const state = createOauthState();
    const redirect = buildGithubOauthUrl(state);

    const response = NextResponse.redirect(redirect);
    response.cookies.set(
      ADMIN_OAUTH_STATE_COOKIE,
      state,
      oauthCookieOptions(adminCookieAges.oauthState),
    );
    response.cookies.set(
      ADMIN_OAUTH_NEXT_COOKIE,
      nextPath,
      oauthCookieOptions(adminCookieAges.oauthState),
    );
    return response;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "OAuth start failed", 500);
  }
}
