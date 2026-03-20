import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepoByOwnerName, listRefreshRuns } from "@/server/data";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; name: string }>;
};

function formatUtc(value: Date): string {
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

function durationText(startedAt: Date, finishedAt: Date | null): string {
  if (!finishedAt) {
    return "running";
  }

  const diffMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${mins}m ${remSeconds}s`;
}

function statusTone(status: string): string {
  if (status === "completed") {
    return "text-score-high";
  }
  if (status === "failed") {
    return "text-score-low";
  }
  return "text-score-mid";
}

export default async function RefreshRunsPage(props: PageProps) {
  const params = await props.params;
  const repo = await getRepoByOwnerName(params.owner, params.name);
  if (!repo) {
    notFound();
  }

  const runs = await listRefreshRuns(repo.id, 40);

  return (
    <main className="min-h-screen">
      <div className="sticky top-0 z-10 border-b border-border bg-base/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 h-14">
          <Link
            href={`/repos/${params.owner}/${params.name}`}
            className="text-sm text-subtle hover:text-heading transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="text-lg font-semibold text-heading tracking-tight">Refresh Runs</h1>
          <div className="w-12" />
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="mb-6 text-sm text-body">
          Latest Trigger runs for <span className="font-mono text-heading">{repo.fullName}</span>.
        </p>

        {runs.length === 0 ? (
          <div className="rounded-xl bg-surface border border-border p-8">
            <p className="text-body">No refresh runs yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <div key={run.id} className="rounded-xl bg-surface border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-heading">Run #{run.id}</p>
                    <span className={`text-xs font-semibold uppercase tracking-wider ${statusTone(run.status)}`}>
                      {run.status}
                    </span>
                  </div>
                  <p className="text-xs text-subtle">{durationText(run.startedAt, run.finishedAt)}</p>
                </div>

                <div className="mt-2 grid gap-2 text-sm text-body sm:grid-cols-2">
                  <p>Started: {formatUtc(run.startedAt)}</p>
                  <p>Finished: {run.finishedAt ? formatUtc(run.finishedAt) : "running"}</p>
                </div>

                {run.errorText ? (
                  <p className="mt-2 rounded-lg bg-base px-3 py-2 text-sm text-score-low">{run.errorText}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
