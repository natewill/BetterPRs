import { NextResponse } from "next/server";
import {
  ADMIN_OAUTH_NEXT_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  ADMIN_SESSION_COOKIE,
  oauthCookieOptions,
} from "@/lib/admin-auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", oauthCookieOptions(0));
  response.cookies.set(ADMIN_OAUTH_STATE_COOKIE, "", oauthCookieOptions(0));
  response.cookies.set(ADMIN_OAUTH_NEXT_COOKIE, "", oauthCookieOptions(0));
  return response;
}

