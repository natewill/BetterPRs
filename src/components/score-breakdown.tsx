import type { ScoreBreakdown } from "@/lib/types";

function scoreColor(value: number): string {
  if (value >= 8) return "#22c55e";
  if (value >= 6) return "#84cc16";
  if (value >= 4) return "#eab308";
  if (value >= 2) return "#f97316";
  return "#ef4444";
}

type ScoreBreakdownProps = {
  breakdown: ScoreBreakdown;
  explanationByKey: Record<string, string>;
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

export function ScoreBreakdown({ breakdown, explanationByKey }: ScoreBreakdownProps) {
  const entries = Object.entries(breakdown);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {entries.map(([dimension, value]) => {
        const color = scoreColor(value);
        const pct = (value / 10) * 100;
        const explanation = explanationByKey[dimension];
        return (
          <div
            key={dimension}
            className={`group relative rounded-lg bg-surface border border-border p-3 ${explanation ? "cursor-help" : ""}`}
            tabIndex={explanation ? 0 : undefined}
          >
            <p className="text-xs text-subtle mb-2">{labelFromKey(dimension)}</p>
            <div className="flex items-end gap-2">
              <span className="font-mono text-lg font-bold leading-none" style={{ color }}>
                {value.toFixed(1)}
              </span>
              <div className="flex-1 h-1 rounded-full bg-border overflow-hidden mb-1">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
            {explanation ? (
              <div className="pointer-events-none absolute left-0 top-full z-20 hidden w-72 pt-2 group-hover:block group-focus-visible:block">
                <div className="rounded-lg border border-border bg-base px-3 py-2 text-sm leading-relaxed text-body shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
                  {explanation}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
