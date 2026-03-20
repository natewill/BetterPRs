import { NextResponse } from "next/server";
import { createTrackedRepo, listTrackedRepos } from "@/server/data";
import { jsonError, repoCreateSchema } from "@/app/api/_lib";

export async function GET() {
  try {
    const repoList = await listTrackedRepos();
    return NextResponse.json({ repos: repoList });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to load repos", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = repoCreateSchema.parse(body);
    const repo = await createTrackedRepo(parsed);
    return NextResponse.json({ repo }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      return jsonError(error.message, 400);
    }
    return jsonError("Invalid request body", 400);
  }
}
