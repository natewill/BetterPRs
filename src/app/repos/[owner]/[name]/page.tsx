import Link from "next/link";
import {
  createTrackedRepo,
  getRankedPrs,
  getRepoByOwnerName,
  getRepoSettings,
  parseSearch,
  parseWindow,
} from "@/server/data";
import { RepoDashboard } from "@/components/repo-dashboard";
import { RefreshButton } from "@/components/refresh-button";
import { scopeValues, typeValues } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; name: string }>;
  searchParams: Promise<{
    window?: string;
    scope?: string;
    type?: string;
    includeFiltered?: string;
    search?: string;
  }>;
};

function toOption(value: string | undefined, allowed: string[]): string | "all" {
  if (!value || value === "all") {
    return "all";
  }
  return allowed.includes(value) ? value : "all";
}

function formatLastRefreshed(value: Date | null): string {
  if (!value) {
    return "never";
  }

  const diffMs = Date.now() - value.getTime();
  const totalMins = Math.max(0, Math.floor(diffMs / 60_000));
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;

  if (hours === 0) {
    return `${mins} mins ago`;
  }

  return `${hours} hours and ${mins} mins ago`;
}

function formatUpdatedAt(value: Date): string {
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = monthNames[value.getUTCMonth()];
  const day = value.getUTCDate();
  const year = value.getUTCFullYear();
  const hours24 = value.getUTCHours();
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${month} ${day}, ${year} at ${hours12}:${minutes} ${suffix} UTC`;
}

export default async function RepoPage(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const window = parseWindow(searchParams.window ?? null);
  const search = parseSearch(searchParams.search ?? null);
  let selectedScope: string | "all" = "all";
  let selectedType: string | "all" = "all";
  let availableScopes = scopeValues;
  let availableTypes = typeValues;
  const includeFiltered = searchParams.includeFiltered === "true";

  let repo: Awaited<ReturnType<typeof getRepoByOwnerName>> | null = null;
  let rows: Awaited<ReturnType<typeof getRankedPrs>> = [];
  let loadError: string | null = null;

  try {
    repo = await getRepoByOwnerName(params.owner, params.name);
    if (!repo) {
      repo = await createTrackedRepo({ owner: params.owner, name: params.name });
    }
    const settings = await getRepoSettings(repo.id);
    if (settings) {
      availableScopes = settings.scopeValuesJson;
      availableTypes = settings.typeValuesJson;
    }
    selectedScope = toOption(searchParams.scope, availableScopes);
    selectedType = toOption(searchParams.type, availableTypes);

    rows = await getRankedPrs(repo.id, {
      window,
      scope: selectedScope,
      type: selectedType,
      includeFiltered,
      search,
    });
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Failed to load repo dashboard. Check DATABASE_URL, GITHUB_TOKEN, and GEMINI_API_KEY.";
  }

  if (loadError || !repo) {
    return (
      <main className="min-h-screen">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="rounded-xl bg-surface border border-border p-8">
            <h1 className="mb-2 text-xl font-semibold text-heading">Configuration needed</h1>
            <p className="text-body">{loadError ?? "Repo is missing."}</p>
          </div>
        </div>
      </main>
    );
  }

  const initialRows = rows.map((row) => ({
    pr: {
      id: row.pr.id,
      githubPrNumber: row.pr.githubPrNumber,
      title: row.pr.title,
      authorLogin: row.pr.authorLogin,
      githubUrl: row.pr.githubUrl,
      inferredScopesJson: row.pr.inferredScopesJson,
      inferredTypesJson: row.pr.inferredTypesJson,
      additions: row.pr.additions,
      deletions: row.pr.deletions,
      changedFiles: row.pr.changedFiles,
      linkedIssueNumbersJson: row.pr.linkedIssueNumbersJson,
      updatedAtText: formatUpdatedAt(row.pr.updatedAt),
    },
    score: row.score
      ? {
          finalScore: row.score.finalScore,
          scoreBreakdownJson: row.score.scoreBreakdownJson,
        }
      : null,
    ai: row.ai ? { beforeOpeningSummary: row.ai.beforeOpeningSummary } : null,
  }));

  return (
    <main className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-base/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 h-16">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-heading tracking-tight">
              {params.owner}
              <span className="text-subtle mx-0.5">/</span>
              {params.name}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/repos/${params.owner}/${params.name}/refresh-runs`}
              className="rounded-lg bg-surface border border-border px-4 py-2 text-sm font-medium text-body hover:text-heading hover:bg-surface-hover transition-all"
            >
              Runs
            </Link>
            <Link
              href={`/settings?repoId=${repo.id}`}
              className="rounded-lg bg-surface border border-border px-4 py-2 text-sm font-medium text-body hover:text-heading hover:bg-surface-hover transition-all"
            >
              Settings
            </Link>
            <RefreshButton repoId={repo.id} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6">
        {/* Last refreshed */}
        <p className="mb-4 text-sm text-subtle">
          Last refreshed {formatLastRefreshed(repo.lastRefreshedAt)}
          <span className="mx-2">·</span>
          made by{" "}
          <a
            href="https://natewilliamsdev.vercel.app"
            target="_blank"
            rel="noreferrer"
            className="text-body underline underline-offset-2 hover:text-heading"
          >
            nate williams
          </a>
        </p>

        <RepoDashboard
          repoId={repo.id}
          repoOwner={params.owner}
          repoName={params.name}
          initialRows={initialRows}
          initialQuery={{
            window,
            scope: selectedScope,
            type: selectedType,
            includeFiltered,
            search,
          }}
          scopeValues={availableScopes}
          typeValues={availableTypes}
        />
      </div>
    </main>
  );
}
