"use client";

import { useState, useTransition } from "react";
import { assert } from "@/lib/assert";
import { Badge } from "@/components/ui/badge";
import { PrCard } from "@/components/pr-card";
import { cn } from "@/lib/utils";
import { timeWindowValues, type TimeWindow } from "@/lib/types";

type PullRow = {
  pr: {
    id: number;
    githubPrNumber: number;
    title: string;
    authorLogin: string;
    githubUrl: string;
    inferredScopesJson: string[];
    inferredTypesJson: string[];
    additions: number;
    deletions: number;
    changedFiles: number;
    linkedIssueNumbersJson: number[];
    updatedAtText: string;
  };
  score: { finalScore: number; scoreBreakdownJson: Record<string, number> } | null;
  ai: { beforeOpeningSummary: string } | null;
};

type QueryState = {
  window: TimeWindow;
  scope: string | "all";
  type: string | "all";
  includeFiltered: boolean;
  search: string;
};

type RepoDashboardProps = {
  repoId: number;
  repoOwner: string;
  repoName: string;
  initialRows: PullRow[];
  initialQuery: QueryState;
  scopeValues: string[];
  typeValues: string[];
};

function loadHiddenPrKeys(prefix: string): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }

  const keys = new Set<string>();
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) {
      continue;
    }
    if (!key.startsWith(prefix)) {
      continue;
    }
    if (localStorage.getItem(key) !== "1") {
      continue;
    }
    keys.add(key);
  }
  return keys;
}

function queryHref(basePath: string, query: QueryState): string {
  const params = new URLSearchParams({
    window: query.window,
    scope: query.scope,
    type: query.type,
  });
  if (query.search) {
    params.set("search", query.search);
  }
  if (query.includeFiltered) {
    params.set("includeFiltered", "true");
  }
  return `${basePath}?${params.toString()}`;
}

function Pill(props: {
  active: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150",
        props.active
          ? "bg-accent text-white shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
          : "text-subtle hover:text-heading hover:bg-surface-hover",
        props.disabled ? "opacity-60" : "",
      )}
    >
      {props.children}
    </button>
  );
}

export function RepoDashboard(props: RepoDashboardProps) {
  const hiddenPrefix = `hidden-pr:${props.repoOwner}/${props.repoName}:`;
  const initialSearch = props.initialQuery.search ?? "";
  const [query, setQuery] = useState<QueryState>({
    ...props.initialQuery,
    search: initialSearch,
  });
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [rows, setRows] = useState(props.initialRows);
  const [hiddenPrKeys, setHiddenPrKeys] = useState<Set<string>>(() =>
    loadHiddenPrKeys(hiddenPrefix),
  );
  const [pending, startTransition] = useTransition();
  const basePath = `/repos/${props.repoOwner}/${props.repoName}`;

  function hiddenStorageKey(prNumber: number): string {
    return `${hiddenPrefix}${prNumber}`;
  }

  function applyQuery(nextQuery: QueryState) {
    startTransition(async () => {
      setQuery(nextQuery);
      window.history.replaceState(null, "", queryHref(basePath, nextQuery));

      const params = new URLSearchParams({
        window: nextQuery.window,
        scope: nextQuery.scope,
        type: nextQuery.type,
      });
      if (nextQuery.search) {
        params.set("search", nextQuery.search);
      }
      if (nextQuery.includeFiltered) {
        params.set("includeFiltered", "true");
      }

      const response = await fetch(`/api/repos/${props.repoId}/pulls?${params.toString()}`, {
        cache: "no-store",
      });
      assert(response.ok, "Failed to load pulls");
      const payload = (await response.json()) as { pulls: PullRow[] };
      setRows(payload.pulls);
    });
  }

  function onSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyQuery({ ...query, search: searchInput.trim() });
  }

  function hidePr(prNumber: number) {
    const key = hiddenStorageKey(prNumber);
    localStorage.setItem(key, "1");
    setHiddenPrKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }

  const visibleRows = rows.filter(
    (row) => !hiddenPrKeys.has(hiddenStorageKey(row.pr.githubPrNumber)),
  );

  return (
    <>
      <div className="mb-8 rounded-xl bg-surface border border-border p-5">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-14 text-xs font-medium uppercase tracking-wider text-subtle">Range</span>
            <div className="flex items-center gap-0.5 rounded-xl bg-surface-raised/50 p-1">
              {timeWindowValues.map((window) => (
                <Pill
                  key={window}
                  active={query.window === window}
                  disabled={pending}
                  onClick={() => applyQuery({ ...query, window })}
                >
                  {window}
                </Pill>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="w-14 text-xs font-medium uppercase tracking-wider text-subtle">Scope</span>
            <div className="flex flex-wrap items-center gap-0.5 rounded-xl bg-surface-raised/50 p-1">
              <Pill
                active={query.scope === "all"}
                disabled={pending}
                onClick={() => applyQuery({ ...query, scope: "all" })}
              >
                all
              </Pill>
              {props.scopeValues.map((scope) => (
                <Pill
                  key={scope}
                  active={query.scope === scope}
                  disabled={pending}
                  onClick={() => applyQuery({ ...query, scope })}
                >
                  {scope}
                </Pill>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="w-14 text-xs font-medium uppercase tracking-wider text-subtle">Type</span>
            <div className="flex flex-wrap items-center gap-0.5 rounded-xl bg-surface-raised/50 p-1">
              <Pill
                active={query.type === "all"}
                disabled={pending}
                onClick={() => applyQuery({ ...query, type: "all" })}
              >
                all
              </Pill>
              {props.typeValues.map((type) => (
                <Pill
                  key={type}
                  active={query.type === type}
                  disabled={pending}
                  onClick={() => applyQuery({ ...query, type })}
                >
                  {type}
                </Pill>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 text-xs font-medium uppercase tracking-wider text-subtle">Search</span>
            <form onSubmit={onSearchSubmit} className="flex flex-1 items-center gap-2">
              <input
                className="w-full max-w-xl px-3 py-1.5 text-sm"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Fuzzy search PR title"
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
              >
                Search
              </button>
              {query.search ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setSearchInput("");
                    applyQuery({ ...query, search: "" });
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm text-body hover:text-heading disabled:opacity-60"
                >
                  Clear
                </button>
              ) : null}
            </form>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-border-subtle">
          <button
            type="button"
            disabled={pending}
            onClick={() => applyQuery({ ...query, includeFiltered: !query.includeFiltered })}
            className="text-sm text-accent hover:text-accent-hover transition-colors disabled:opacity-60"
          >
            {query.includeFiltered ? "Hide team-member PRs" : "Include team-member PRs"}
          </button>
        </div>
      </div>

      <div className={pending ? "opacity-70" : ""}>
        {visibleRows.length === 0 ? (
          <div className="rounded-xl bg-surface border border-border py-20 text-center">
            <p className="text-lg text-body">No pull requests in this time range.</p>
            <p className="mt-1 text-sm text-subtle">Run a refresh to start scoring PRs.</p>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-subtle">
                {visibleRows.length} pull request{visibleRows.length !== 1 ? "s" : ""} ranked by score
              </h2>
              {pending ? <span className="text-xs text-subtle">Updating…</span> : null}
            </div>
            <div className="space-y-3">
              {visibleRows.map((row) => {
                if (!row.score || !row.ai) {
                  return (
                    <div
                      key={row.pr.id}
                      className="flex items-center justify-between rounded-xl bg-surface border border-border p-5"
                    >
                      <span className="text-heading">{row.pr.title}</span>
                      <Badge tone="muted">pending</Badge>
                    </div>
                  );
                }

                return (
                  <div key={row.pr.id} className="relative">
                    <button
                      type="button"
                      aria-label={`Hide PR #${row.pr.githubPrNumber}`}
                      onClick={() => hidePr(row.pr.githubPrNumber)}
                      className="absolute right-2 top-2 z-20 rounded-md px-2 py-1 text-xs text-subtle hover:bg-surface-raised hover:text-heading"
                    >
                      x
                    </button>
                    <PrCard
                      repoOwner={props.repoOwner}
                      repoName={props.repoName}
                      pr={row.pr}
                      finalScore={row.score.finalScore}
                      scoreBreakdown={row.score.scoreBreakdownJson}
                      beforeOpeningSummary={row.ai.beforeOpeningSummary}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
