type ScoreBarProps = {
  score: number;
};

export function ScoreBar({ score }: ScoreBarProps) {
  const pct = Math.min(100, Math.max(0, score));

  // Gradient from red -> yellow -> green
  let color: string;
  if (score >= 80) color = "#22c55e";
  else if (score >= 60) color = "#84cc16";
  else if (score >= 40) color = "#eab308";
  else if (score >= 20) color = "#f97316";
  else color = "#ef4444";

  return (
    <div className="flex items-center gap-3 shrink-0">
      <span
        className="font-mono text-2xl font-bold tabular-nums leading-none"
        style={{ color }}
      >
        {score.toFixed(0)}
      </span>
      <div className="w-24 h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
