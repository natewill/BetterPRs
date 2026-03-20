import { cn } from "@/lib/utils";

type BadgeProps = {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "muted";
  className?: string;
};

const tones = {
  accent: "bg-accent/15 text-accent-hover",
  muted: "bg-surface-raised text-subtle",
  neutral: "bg-surface-raised text-body",
};

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
