import Link from "next/link";
import { cn } from "@/lib/utils";
import { timeWindowValues } from "@/lib/types";

type FilterLinksProps = {
  basePath: string;
  selectedWindow: (typeof timeWindowValues)[number];
  selectedScope: string | "all";
  selectedType: string | "all";
  scopeValues: string[];
  typeValues: string[];
};

function filterHref(
  basePath: string,
  window: string,
  scope: string,
  type: string,
): string {
  const query = new URLSearchParams({ window, scope, type });
  return `${basePath}?${query.toString()}`;
}

function Pill(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150",
        props.active
          ? "bg-accent text-white shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
          : "text-subtle hover:text-heading hover:bg-surface-hover",
      )}
    >
      {props.children}
    </Link>
  );
}

export function FilterLinks({
  basePath,
  selectedWindow,
  selectedScope,
  selectedType,
  scopeValues,
  typeValues,
}: FilterLinksProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-14 text-xs font-medium uppercase tracking-wider text-subtle">Range</span>
        <div className="flex items-center gap-0.5 rounded-xl bg-surface-raised/50 p-1">
          {timeWindowValues.map((window) => (
            <Pill
              key={window}
              href={filterHref(basePath, window, selectedScope, selectedType)}
              active={selectedWindow === window}
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
            href={filterHref(basePath, selectedWindow, "all", selectedType)}
            active={selectedScope === "all"}
          >
            all
          </Pill>
          {scopeValues.map((scope) => (
            <Pill
              key={scope}
              href={filterHref(basePath, selectedWindow, scope, selectedType)}
              active={selectedScope === scope}
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
            href={filterHref(basePath, selectedWindow, selectedScope, "all")}
            active={selectedType === "all"}
          >
            all
          </Pill>
          {typeValues.map((type) => (
            <Pill
              key={type}
              href={filterHref(basePath, selectedWindow, selectedScope, type)}
              active={selectedType === type}
            >
              {type}
            </Pill>
          ))}
        </div>
      </div>
    </div>
  );
}
