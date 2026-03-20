import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ViewedTitle } from "@/components/viewed-badge";
import { ScoreBar } from "@/components/score-bar";
import { Markdown } from "@/components/markdown";
import type { ScoreBreakdown } from "@/lib/types";

type PrCardProps = {
  repoOwner: string;
  repoName: string;
  pr: {
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
  finalScore: number;
  scoreBreakdown: ScoreBreakdown;
  beforeOpeningSummary: string;
};

function labelFromKey(key: string): string {
  if (key === "contributorTrust") return "Trust";
  if (key === "sizeEfficiency") return "Size";
  if (key === "communityTraction") return "Traction";
  if (key === "mergeReadiness") return "Readiness";
  if (key === "guidelineFit") return "Guidelines";

  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function scoreColor(value: number): string {
  if (value >= 8) return "#22c55e";
  if (value >= 6) return "#84cc16";
  if (value >= 4) return "#eab308";
  if (value >= 2) return "#f97316";
  return "#ef4444";
}

export function PrCard(props: PrCardProps) {
  const viewedStorageKey = `viewed-pr:${props.repoOwner}/${props.repoName}:${props.pr.githubPrNumber}`;
  const detailHref = `/repos/${props.repoOwner}/${props.repoName}/pulls/${props.pr.githubPrNumber}`;
  const breakdownEntries = Object.entries(props.scoreBreakdown);

  return (
    <Link href={detailHref} className="group block">
      <div className="rounded-xl bg-surface border border-border p-5 transition-all duration-200 group-hover:bg-surface-hover group-hover:border-border/80 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.05)]">
        {/* Top row: score + title */}
        <div className="flex items-start gap-5">
          <div className="relative shrink-0 group/score">
            <ScoreBar score={props.finalScore} />
            <div className="pointer-events-none absolute left-0 top-full z-30 hidden min-w-52 pt-2 group-hover/score:block">
              <div className="rounded-lg border border-border bg-base px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-subtle">
                  Sub-scores
                </p>
                <div className="space-y-1.5">
                  {breakdownEntries.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-body">{labelFromKey(key)}</span>
                      <span className="font-mono" style={{ color: scoreColor(value) }}>
                        {value.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[17px] font-semibold text-heading leading-snug group-hover:text-accent transition-colors">
              <ViewedTitle storageKey={viewedStorageKey}>{props.pr.title}</ViewedTitle>
            </h3>
          </div>
        </div>

        {/* Badges + meta row */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {props.pr.inferredScopesJson.map((scope) => (
            <Badge key={`scope-${scope}`} tone="accent">
              {scope}
            </Badge>
          ))}
          {props.pr.inferredTypesJson.map((type) => (
            <Badge key={`type-${type}`}>{type}</Badge>
          ))}
          <span className="text-subtle text-xs">
            #{props.pr.githubPrNumber}
          </span>
          <span className="text-xs text-subtle">·</span>
          <span className="text-subtle text-xs">@{props.pr.authorLogin}</span>
          <span className="text-xs text-subtle">·</span>
          <span className="text-subtle text-xs">last updated {props.pr.updatedAtText}</span>
          <span className="text-xs text-subtle">·</span>
          <span className="text-xs text-score-high">+{props.pr.additions}</span>
          <span className="text-xs text-score-low">−{props.pr.deletions}</span>
          <span className="text-subtle text-xs">·</span>
          <span className="text-subtle text-xs">{props.pr.changedFiles} files</span>
          {props.pr.linkedIssueNumbersJson.length > 0 && (
            <>
              <span className="text-subtle text-xs">·</span>
              <span className="text-subtle text-xs">{props.pr.linkedIssueNumbersJson.length} issues</span>
            </>
          )}
        </div>

        {/* Summary */}
        <div className="mt-3 text-sm text-body">
          <Markdown content={props.beforeOpeningSummary} />
        </div>
      </div>
    </Link>
  );
}
