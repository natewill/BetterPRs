import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jsonError } from "@/app/api/_lib";
import { assert } from "@/lib/assert";
import { getDb } from "@/lib/db/client";
import { pullRequests, repos } from "@/lib/db/schema";

type PullRequestWebhookPayload = {
  action: string;
  repository: {
    full_name: string;
  };
  pull_request: {
    number: number;
  };
};

function verifyGithubSignature(body: string, signatureHeader: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const actualBuffer = Buffer.from(signatureHeader, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  assert(secret, "Missing GITHUB_WEBHOOK_SECRET");

  const signatureHeader = request.headers.get("x-hub-signature-256");
  if (!signatureHeader) {
    return jsonError("Missing GitHub signature header", 401);
  }

  const event = request.headers.get("x-github-event");
  if (!event) {
    return jsonError("Missing GitHub event header", 400);
  }

  const body = await request.text();
  if (!verifyGithubSignature(body, signatureHeader, secret)) {
    return jsonError("Invalid GitHub signature", 401);
  }

  if (event === "ping") {
    return NextResponse.json({ ok: true });
  }

  if (event !== "pull_request") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const payload = JSON.parse(body) as PullRequestWebhookPayload;
  if (payload.action !== "closed") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = getDb();
  const repoRows = await db
    .select({ id: repos.id })
    .from(repos)
    .where(eq(repos.fullName, payload.repository.full_name))
    .limit(1);

  if (repoRows.length === 0) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const repo = repoRows[0];
  const deleted = await db
    .delete(pullRequests)
    .where(
      and(
        eq(pullRequests.repoId, repo.id),
        eq(pullRequests.githubPrNumber, payload.pull_request.number),
      ),
    )
    .returning({ id: pullRequests.id });

  return NextResponse.json({
    ok: true,
    repoId: repo.id,
    githubPrNumber: payload.pull_request.number,
    deleted: deleted.length > 0,
  });
}

