import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "ghost";
};

export function Button({ tone = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-9 cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-medium transition-all",
        tone === "primary"
          ? "bg-accent text-white hover:bg-accent-hover shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)]"
          : "bg-surface text-body border border-border hover:bg-surface-hover hover:text-heading",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
    />
  );
}
