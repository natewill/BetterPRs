import crypto from "node:crypto";
import { z } from "zod";
import { assert } from "@/lib/assert";

export const ADMIN_SESSION_COOKIE = "betterprs_admin_session";
export const ADMIN_OAUTH_STATE_COOKIE = "betterprs_admin_oauth_state";
export const ADMIN_OAUTH_NEXT_COOKIE = "betterprs_admin_oauth_next";

const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const ADMIN_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

const adminAuthEnvSchema = z.object({
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1),
  ADMIN_AUTH_SECRET: z.string().min(1),
});

type AdminAuthEnv = z.infer<typeof adminAuthEnvSchema>;

let cachedAdminAuthEnv: AdminAuthEnv | null = null;

export function isAdminAuthConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_OAUTH_CLIENT_ID &&
      process.env.GITHUB_OAUTH_CLIENT_SECRET &&
      process.env.ADMIN_AUTH_SECRET,
  );
}

function getAdminAuthEnv(): AdminAuthEnv {
  if (cachedAdminAuthEnv) {
    return cachedAdminAuthEnv;
  }

  const parsed = adminAuthEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid admin auth environment: ${parsed.error.message}`);
  }
  cachedAdminAuthEnv = parsed.data;
  return cachedAdminAuthEnv;
}

function sign(input: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

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

export function sanitizeNextPath(input: string | null): string {
  if (!input) {
    return "/settings";
  }
  if (!input.startsWith("/")) {
    return "/settings";
  }
  return input;
}

export function createOauthState(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function buildGithubOauthUrl(state: string): string {
  const env = getAdminAuthEnv();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGithubCodeForToken(code: string, state: string): Promise<string> {
  const env = getAdminAuthEnv();
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      state,
    }),
  });

  assert(response.ok, `GitHub OAuth token exchange failed with status ${response.status}`);
  const payload = z
    .object({
      access_token: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    })
    .parse(await response.json());

  assert(payload.access_token, payload.error_description ?? payload.error ?? "GitHub OAuth failed");
  return payload.access_token;
}

export async function fetchGithubLogin(accessToken: string): Promise<string> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  assert(response.ok, `GitHub user fetch failed with status ${response.status}`);

  const payload = z.object({ login: z.string().min(1) }).parse(await response.json());
  return payload.login;
}

export function createAdminSessionCookieValue(login: string): string {
  const env = getAdminAuthEnv();
  const expiresAt = Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ login, expiresAt })).toString("base64url");
  const signature = sign(payload, env.ADMIN_AUTH_SECRET);
  return `${payload}.${signature}`;
}

export function getAdminLoginFromRequest(request: Request): string | null {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const raw = cookies.get(ADMIN_SESSION_COOKIE);
  if (!raw) {
    return null;
  }

  const env = getAdminAuthEnv();

  const parts = raw.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const payload = parts[0];
  const signature = parts[1];
  const expected = sign(payload, env.ADMIN_AUTH_SECRET);
  if (!equal(signature, expected)) {
    return null;
  }

  const parsed = z
    .object({
      login: z.string().min(1),
      expiresAt: z.number(),
    })
    .parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));

  if (parsed.expiresAt <= Date.now()) {
    return null;
  }

  return parsed.login;
}

export function isAdminRequestAuthorized(request: Request): boolean {
  return getAdminLoginFromRequest(request) !== null;
}

export function oauthCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export const adminCookieAges = {
  session: ADMIN_SESSION_MAX_AGE_SECONDS,
  oauthState: ADMIN_OAUTH_STATE_MAX_AGE_SECONDS,
};
