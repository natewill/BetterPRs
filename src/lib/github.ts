import { assert } from "@/lib/assert";
import { getEnv } from "@/lib/env";

const GITHUB_TIMEOUT_MS = 30_000;

export type GithubRepoRef = {
  owner: string;
  name: string;
};

export type GithubPullRequestListItem = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  user: { login: string; type: string };
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  labels: Array<{ name: string }>;
  comments: number;
  review_comments: number;
  html_url: string;
  issue_url: string;
  base: { repo: { full_name: string } };
};

export type GithubPullRequestDetail = GithubPullRequestListItem & {
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
};

export type GithubIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  comments: number;
  html_url: string;
  created_at: string;
  updated_at: string;
  user: { login: string };
  reactions?: { total_count: number };
  pull_request?: {
    url: string;
    html_url: string;
    diff_url: string;
    patch_url: string;
  };
};

export type GithubIssueComment = {
  id: number;
  body: string | null;
  created_at: string;
  user: { login: string };
  reactions?: { total_count: number };
};

export type GithubPullFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

type GithubRateLimitResponse = {
  resources?: {
    core?: {
      limit: number;
      remaining: number;
      reset: number;
    };
  };
};

type GithubIssueSearchResponse = {
  total_count: number;
};

type GithubTimelineEvent = {
  event: string;
  source?: {
    issue?: { number: number };
  };
  subject?: {
    type?: string;
    url?: string;
  };
};

function githubHeaders(extra?: Record<string, string>): HeadersInit {
  const env = getEnv();
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

async function githubGet<T>(
  path: string,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    method: "GET",
    headers: githubHeaders(extraHeaders),
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub request failed (${response.status}) ${path}: ${body}`);
  }

  return (await response.json()) as T;
}

async function githubGetAllPages<T>(path: string, maxPages = 10): Promise<T[]> {
  const allItems: T[] = [];
  let page = 1;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const pagePath = `${path}${separator}per_page=100&page=${page}`;
    const items = await githubGet<T[]>(pagePath);
    allItems.push(...items);

    if (items.length < 100) {
      return allItems;
    }

    page += 1;
    if (page > maxPages) {
      return allItems;
    }
  }
}

export async function fetchOpenPullRequests(
  repo: GithubRepoRef,
): Promise<GithubPullRequestListItem[]> {
  return githubGetAllPages<GithubPullRequestListItem>(
    `/repos/${repo.owner}/${repo.name}/pulls?state=open&sort=updated&direction=desc`,
  );
}

export async function fetchPullRequest(
  repo: GithubRepoRef,
  prNumber: number,
): Promise<GithubPullRequestDetail> {
  return githubGet<GithubPullRequestDetail>(
    `/repos/${repo.owner}/${repo.name}/pulls/${prNumber}`,
  );
}

export async function fetchPullRequestFiles(
  repo: GithubRepoRef,
  prNumber: number,
): Promise<GithubPullFile[]> {
  return githubGetAllPages<GithubPullFile>(
    `/repos/${repo.owner}/${repo.name}/pulls/${prNumber}/files`,
  );
}

export async function fetchPullRequestIssueComments(
  repo: GithubRepoRef,
  prNumber: number,
): Promise<GithubIssueComment[]> {
  return githubGetAllPages<GithubIssueComment>(
    `/repos/${repo.owner}/${repo.name}/issues/${prNumber}/comments`,
  );
}

export async function fetchPullRequestReviewComments(
  repo: GithubRepoRef,
  prNumber: number,
): Promise<GithubIssueComment[]> {
  return githubGetAllPages<GithubIssueComment>(
    `/repos/${repo.owner}/${repo.name}/pulls/${prNumber}/comments`,
  );
}

export async function fetchIssue(
  repo: GithubRepoRef,
  issueNumber: number,
): Promise<GithubIssue> {
  return githubGet<GithubIssue>(`/repos/${repo.owner}/${repo.name}/issues/${issueNumber}`);
}

export function isPullRequestIssue(issue: GithubIssue): boolean {
  return Boolean(issue.pull_request);
}

export async function fetchPullRequestTimeline(
  repo: GithubRepoRef,
  prNumber: number,
): Promise<GithubTimelineEvent[]> {
  return githubGetAllPages<GithubTimelineEvent>(
    `/repos/${repo.owner}/${repo.name}/issues/${prNumber}/timeline`,
  );
}

export async function fetchAuthorMergedPrCount(
  repo: GithubRepoRef,
  authorLogin: string,
): Promise<number> {
  const query = `repo:${repo.owner}/${repo.name} is:pr is:merged author:${authorLogin}`;
  const encodedQuery = encodeURIComponent(query);
  const payload = await githubGet<GithubIssueSearchResponse>(
    `/search/issues?q=${encodedQuery}&per_page=1`,
  );
  return payload.total_count;
}

export async function fetchCoreRateLimitStatus(): Promise<{
  limit: number;
  remaining: number;
  resetAt: Date;
}> {
  const payload = await githubGet<GithubRateLimitResponse>("/rate_limit");
  const core = payload.resources?.core;
  assert(core, "GitHub rate-limit payload missing core resource");
  return {
    limit: core.limit,
    remaining: core.remaining,
    resetAt: new Date(core.reset * 1000),
  };
}

export function parseClosingIssueNumbersFromText(text: string): number[] {
  const matches = text.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi);
  const numbers: number[] = [];

  for (const match of matches) {
    const issueNumber = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(issueNumber)) {
      numbers.push(issueNumber);
    }
  }

  return [...new Set(numbers)];
}

function parseIssueNumberFromUrl(url: string | undefined): number | null {
  if (!url) {
    return null;
  }

  const match = url.match(/\/issues\/(\d+)$/);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

export function resolveLinkedIssueNumbersFromPr(
  pr: GithubPullRequestListItem,
  timelineEvents: GithubTimelineEvent[],
): number[] {
  const bodyNumbers = parseClosingIssueNumbersFromText(pr.body ?? "");

  const timelineNumbers = timelineEvents
    .filter((event) => event.event === "connected")
    .map((event) => {
      const fromSource = event.source?.issue?.number ?? null;
      if (fromSource) {
        return fromSource;
      }
      return parseIssueNumberFromUrl(event.subject?.url);
    })
    .filter((value): value is number => typeof value === "number");

  const unique = [...new Set([...timelineNumbers, ...bodyNumbers])];
  return unique.filter((issueNumber) => issueNumber !== pr.number);
}

export function getPrFullName(pr: GithubPullRequestListItem): string {
  const fullName = pr.base.repo.full_name;
  assert(fullName.includes("/"), `Invalid GitHub full name: ${fullName}`);
  return fullName;
}
