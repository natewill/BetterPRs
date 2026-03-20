import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">BetterPRs</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-tight text-heading sm:text-5xl">
          Find the most worthwhile pull requests to review first.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-body sm:text-lg">
          A focused PR triage dashboard for open-source maintainers. Built for fast scanning, clear rankings, and high-signal summaries.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/repos/anomalyco/opencode"
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover transition-colors"
          >
            Open Demo Dashboard
          </Link>
          <Link
            href="/repos/anomalyco/opencode/refresh-runs"
            className="rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-heading hover:bg-surface-hover transition-colors"
          >
            View Refresh Runs
          </Link>
        </div>

      </div>
    </main>
  );
}
