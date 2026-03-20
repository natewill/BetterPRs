"use client";

import { useEffect } from "react";
import { markViewed } from "@/components/viewed-badge";

type MarkPrViewedProps = {
  storageKey: string;
};

export function MarkPrViewed({ storageKey }: MarkPrViewedProps) {
  useEffect(() => {
    markViewed(storageKey);
  }, [storageKey]);

  return null;
}
