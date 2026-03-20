"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type ViewedTitleProps = {
  storageKey: string;
  children: React.ReactNode;
};

export function ViewedTitle({ storageKey, children }: ViewedTitleProps) {
  const isViewed = useSyncExternalStore(
    (callback) => {
      window.addEventListener("storage", callback);
      return () => window.removeEventListener("storage", callback);
    },
    () => localStorage.getItem(storageKey) === "1",
    () => false,
  );

  return <span className={cn(isViewed ? "opacity-55" : "")}>{children}</span>;
}

export function markViewed(storageKey: string) {
  localStorage.setItem(storageKey, "1");
}
