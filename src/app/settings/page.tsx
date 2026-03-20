import Link from "next/link";
import { assert } from "@/lib/assert";
import {
  parseScopeValuesJson,
  parseScoreFieldConfigsJson,
  parseTypeValuesJson,
} from "@/lib/types";
import { SettingsForm } from "@/components/settings-form";
import { listTrackedRepos, getRepoSettings, getRefreshStatus } from "@/server/data";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ repoId?: string }>;
};

export default async function SettingsPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const repos = await listTrackedRepos();

  if (repos.length === 0) {
    return (
      <main className="min-h-screen">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <div className="rounded-xl bg-surface border border-border p-8">
            <h1 className="mb-2 text-xl font-semibold text-heading">Settings</h1>
            <p className="text-body">
              No tracked repos. Create one via <code className="font-mono text-accent">/api/repos</code>.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const repoIdFromQuery = Number.parseInt(searchParams.repoId ?? "", 10);
  const selectedRepo =
    repos.find((repo) => repo.id === repoIdFromQuery) ??
    repos.find((repo) => repo.fullName === "anomalyco/opencode") ??
    repos[0];
  const settings = await getRepoSettings(selectedRepo.id);
  const refreshStatus = await getRefreshStatus(selectedRepo.id);

  if (!settings) {
    return (
      <main className="min-h-screen">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <div className="rounded-xl bg-surface border border-border p-8">
            <h1 className="mb-2 text-xl font-semibold text-heading">Settings</h1>
            <p className="text-body">No settings row found for this repo.</p>
          </div>
        </div>
      </main>
    );
  }

  const initialScopeValues = parseScopeValuesJson(settings.scopeValuesJson);
  const initialTypeValues = parseTypeValuesJson(settings.typeValuesJson);
  const initialScoreFields = parseScoreFieldConfigsJson(settings.activeWeightsJson);

  assert(Array.isArray(settings.teamMembersJson), "teamMembersJson must be an array");
  assert(Array.isArray(settings.botUsersJson), "botUsersJson must be an array");

  return (
    <main className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-base/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 h-14">
          <Link
            href={`/repos/${selectedRepo.owner}/${selectedRepo.name}`}
            className="text-sm text-subtle hover:text-heading transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="text-xl font-semibold text-heading tracking-tight">Settings</h1>
          <div className="w-12" />
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="mb-6 text-sm text-body">
          Manage team-member exclusion, scoring fields, and LLM sub-prompts.
        </p>

        {/* Repo selector */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {repos.map((repo) => (
            <Link
              key={repo.id}
              href={`/settings?repoId=${repo.id}`}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                repo.id === selectedRepo.id
                  ? "bg-accent text-white shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                  : "bg-surface border border-border text-body hover:text-heading hover:bg-surface-hover"
              }`}
            >
              {repo.fullName}
            </Link>
          ))}
        </div>

        <SettingsForm
          repoId={selectedRepo.id}
          initialTeamMembers={settings.teamMembersJson}
          initialBotUsers={settings.botUsersJson}
          initialScopeValues={initialScopeValues}
          initialTypeValues={initialTypeValues}
          initialScoreFields={initialScoreFields}
        />

        {/* Refresh status */}
        <div className="mt-6 rounded-xl bg-surface border border-border p-5">
          <p className="text-sm font-semibold text-heading">Latest refresh</p>
          {!refreshStatus ? (
            <p className="mt-2 text-sm text-body">No runs yet.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-surface-raised p-3">
                <p className="text-xs text-subtle">Status</p>
                <p className="mt-0.5 text-sm font-medium text-heading">{refreshStatus.status}</p>
              </div>
              <div className="rounded-lg bg-surface-raised p-3">
                <p className="text-xs text-subtle">Started</p>
                <p className="mt-0.5 text-sm text-body">{new Date(refreshStatus.startedAt).toLocaleString()}</p>
              </div>
              <div className="rounded-lg bg-surface-raised p-3">
                <p className="text-xs text-subtle">Finished</p>
                <p className="mt-0.5 text-sm text-body">
                  {refreshStatus.finishedAt
                    ? new Date(refreshStatus.finishedAt).toLocaleString()
                    : "running"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
