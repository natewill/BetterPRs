import Link from "next/link";
import { notFound } from "next/navigation";
import { assert } from "@/lib/assert";
import { getRepoByOwnerName, getPrDetail, getRepoSettings } from "@/server/data";
import { Badge } from "@/components/ui/badge";
import { MarkPrViewed } from "@/components/mark-pr-viewed";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { ScoreBar } from "@/components/score-bar";
import { Markdown } from "@/components/markdown";
import { DiffView } from "@/components/diff-view";

export const dynamic = "force-dynamic";

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

type PageProps = {
  params: Promise<{ owner: string; name: string; number: string }>;
};

export default async function PullRequestDetailPage(props: PageProps) {
  const params = await props.params;
  const prNumber = Number.parseInt(params.number, 10);

  const repo = await getRepoByOwnerName(params.owner, params.name);
  if (!repo) {
    notFound();
  }

  const detail = await getPrDetail(repo.id, prNumber);
  if (!detail) {
    notFound();
  }
  const settings = await getRepoSettings(repo.id);
  if (!settings) {
    notFound();
  }

  const scoreExplanationByKey = Object.fromEntries(
    settings.activeWeightsJson.map((field) => [field.key, field.prompt]),
  );
  if (detail.ai) {
    Object.assign(scoreExplanationByKey, detail.ai.dimensionExplanationsJson);
  }
  if (detail.ai && detail.score) {
    assert(detail.author, `Missing author row for prId=${detail.pr.id}`);
    scoreExplanationByKey.contributorTrust = `Author has ${detail.author.mergedPrCount} merged PRs in this repo, so trust is scored deterministically in the app.`;
  }

  const storageKey = `viewed-pr:${params.owner}/${params.name}:${prNumber}`;

  return (
    <main className="min-h-screen">
      <MarkPrViewed storageKey={storageKey} />

      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-base/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center px-6 h-14">
          <Link
            href={`/repos/${params.owner}/${params.name}`}
            className="text-sm text-subtle hover:text-heading transition-colors"
          >
            &larr; {params.owner}/{params.name}
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Title + score */}
        <div className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-subtle mb-2">
                #{detail.pr.githubPrNumber} · @{detail.pr.authorLogin} · opened{" "}
                {formatUpdatedAt(detail.pr.createdAt)} · last updated {formatUpdatedAt(detail.pr.updatedAt)}
              </p>
              <h1 className="text-2xl font-bold text-heading leading-snug tracking-tight">
                {detail.pr.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {detail.pr.inferredScopesJson.map((scope) => (
                  <Badge key={`scope-${scope}`} tone="accent">
                    {scope}
                  </Badge>
                ))}
                {detail.pr.inferredTypesJson.map((type) => (
                  <Badge key={`type-${type}`}>{type}</Badge>
                ))}
                {detail.pr.filteredOut ? <Badge tone="muted">filtered</Badge> : null}
              </div>
            </div>
            {detail.score ? (
              <div className="flex flex-col items-end gap-2">
                <ScoreBar score={detail.score.finalScore} />
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-score-high">+{detail.pr.additions}</span>
                  <span className="text-score-low">−{detail.pr.deletions}</span>
                  <span className="text-subtle">{detail.pr.changedFiles} files</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Score breakdown */}
        {detail.score ? (
          <div className="mb-6">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-subtle">Score breakdown</p>
            <ScoreBreakdown
              breakdown={detail.score.scoreBreakdownJson}
              explanationByKey={scoreExplanationByKey}
            />
          </div>
        ) : null}

        {/* AI Analysis */}
        {detail.ai ? (
          <div className="mb-6 rounded-xl bg-surface border border-border p-6 space-y-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle mb-1.5">Summary</p>
              <div className="text-heading">
                <Markdown content={detail.ai.beforeOpeningSummary} />
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-6 rounded-xl bg-surface border border-border p-6">
            <p className="text-body">AI analysis has not run yet.</p>
          </div>
        )}

        <a
          href={detail.pr.githubUrl}
          target="_blank"
          rel="noreferrer"
          className="mb-8 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-all shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
        >
          Open in GitHub
        </a>

        {/* Description */}
        <div className="mb-6 rounded-xl bg-surface border border-border p-6">
          <h2 className="mb-3 text-base font-semibold text-heading">Description</h2>
          {detail.pr.body ? (
            <Markdown content={detail.pr.body} />
          ) : (
            <p className="text-sm text-body">No description.</p>
          )}
        </div>

        {/* Linked issues */}
        <div className="mb-6 rounded-xl bg-surface border border-border p-6">
          <h2 className="mb-3 text-base font-semibold text-heading">Linked Issues</h2>
          {detail.linkedIssues.length === 0 ? (
            <p className="text-sm text-body">None.</p>
          ) : (
            <div className="space-y-3">
              {detail.linkedIssues.map((issue) => (
                <div key={issue.id} className="rounded-lg bg-surface-raised p-4">
                  <p className="text-sm font-medium text-heading">
                    #{issue.githubIssueNumber} {issue.title}
                  </p>
                  <a
                    href={issue.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-sm text-accent hover:text-accent-hover transition-colors"
                  >
                    View issue
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comments */}
        <div className="mb-6 rounded-xl bg-surface border border-border p-6">
          <h2 className="mb-3 text-base font-semibold text-heading">Comments</h2>
          {!detail.snapshot ? (
            <p className="text-sm text-body">No snapshot yet.</p>
          ) : (
            <div className="space-y-5">
              {detail.snapshot.dataJson.prComments.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-subtle">PR comments</p>
                  <div className="space-y-2">
                    {detail.snapshot.dataJson.prComments.map((comment) => (
                      <div key={comment.id} className="rounded-lg bg-surface-raised p-4">
                        <p className="text-xs font-semibold text-accent mb-1">{comment.author}</p>
                        <Markdown content={comment.body} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.snapshot.dataJson.reviewComments.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-subtle">Review comments</p>
                  <div className="space-y-2">
                    {detail.snapshot.dataJson.reviewComments.map((comment) => (
                      <div key={comment.id} className="rounded-lg bg-surface-raised p-4">
                        <p className="text-xs font-semibold text-accent mb-1">{comment.author}</p>
                        <Markdown content={comment.body} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.snapshot.dataJson.prComments.length === 0 &&
                detail.snapshot.dataJson.reviewComments.length === 0 && (
                  <p className="text-sm text-body">No comments.</p>
                )}
            </div>
          )}
        </div>

        {/* Changed files */}
        <div className="rounded-xl bg-surface border border-border p-6">
          <h2 className="mb-3 text-base font-semibold text-heading">Changed Files</h2>
          {!detail.snapshot ? (
            <p className="text-sm text-body">No snapshot yet.</p>
          ) : detail.snapshot.dataJson.changedFiles.length === 0 ? (
            <p className="text-sm text-body">No files.</p>
          ) : (
            <div className="space-y-3">
              {detail.snapshot.dataJson.changedFiles.map((file) => (
                <div key={file.filename} className="rounded-lg bg-surface-raised p-4">
                  <div className="flex items-center gap-3">
                    <p className="font-mono text-sm text-heading">{file.filename}</p>
                    <span className="text-xs text-score-high">+{file.additions}</span>
                    <span className="text-xs text-score-low">−{file.deletions}</span>
                  </div>
                  {file.patchExcerpt ? (
                    <DiffView
                      patch={file.patchExcerpt}
                      filename={file.filename}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
