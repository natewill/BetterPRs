import { NextResponse } from "next/server";
import { jsonError } from "@/app/api/_lib";
import {
  ADMIN_OAUTH_NEXT_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  ADMIN_SESSION_COOKIE,
  adminCookieAges,
  createAdminSessionCookieValue,
  exchangeGithubCodeForToken,
  fetchGithubLogin,
  isAdminAuthConfigured,
  oauthCookieOptions,
  sanitizeNextPath,
} from "@/lib/admin-auth";

type Query = {
  code: string;
  state: string;
};

function parseCookieHeader(header: string | null): Map<string, string> {
  const cookieMap = new Map<string, string>();
  if (!header) {
    return cookieMap;
  }

  const pairs = header.split(";");
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index < 0) {
      continue;
    }

    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    cookieMap.set(key, decodeURIComponent(value));
  }

  return cookieMap;
}

function parseQuery(request: Request): Query {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    throw new Error("Missing OAuth code/state");
  }
  return { code, state };
}

export async function GET(request: Request) {
  try {
    if (!isAdminAuthConfigured()) {
      return jsonError("Admin OAuth is not configured on the server", 503);
    }

    const { code, state } = parseQuery(request);
    const cookieMap = parseCookieHeader(request.headers.get("cookie"));
    const expectedState = cookieMap.get(ADMIN_OAUTH_STATE_COOKIE);
    if (!expectedState || expectedState !== state) {
      return jsonError("Invalid OAuth state", 401);
    }

    const accessToken = await exchangeGithubCodeForToken(code, state);
    const login = await fetchGithubLogin(accessToken);

    const nextPath = sanitizeNextPath(cookieMap.get(ADMIN_OAUTH_NEXT_COOKIE) ?? null);
    const response = NextResponse.redirect(new URL(nextPath, request.url));
    response.cookies.set(
      ADMIN_SESSION_COOKIE,
      createAdminSessionCookieValue(login),
      oauthCookieOptions(adminCookieAges.session),
    );
    response.cookies.set(ADMIN_OAUTH_STATE_COOKIE, "", oauthCookieOptions(0));
    response.cookies.set(ADMIN_OAUTH_NEXT_COOKIE, "", oauthCookieOptions(0));
    return response;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "OAuth callback failed", 400);
  }
}
