"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type RefreshButtonProps = {
  repoId: number;
};

type StatusMessage =
  | { kind: "success"; text: string }
  | { kind: "error"; text: string };

export function RefreshButton(props: RefreshButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<StatusMessage | null>(null);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timeout = setTimeout(() => {
      setMessage(null);
    }, 3500);

    return () => clearTimeout(timeout);
  }, [message]);

  function onClick() {
    startTransition(async () => {
      setMessage(null);
      const response = await fetch(`/api/repos/${props.repoId}/refresh`, {
        method: "POST",
      });

      if (response.status === 503) {
        const payload = (await response.json()) as { error?: string };
        setMessage({
          kind: "error",
          text: payload.error ?? "Admin OAuth is not configured.",
        });
        return;
      }

      if (response.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/api/auth/github/start?next=${encodeURIComponent(next)}`);
        return;
      }

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setMessage({
          kind: "error",
          text: payload.error ?? "Failed to start refresh.",
        });
        return;
      }

      setMessage({ kind: "success", text: "Refresh queued." });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-all shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] disabled:opacity-60"
      >
        {pending ? "Refreshing..." : "Refresh"}
      </button>
      {message ? (
        <p className={`text-xs ${message.kind === "error" ? "text-score-low" : "text-score-high"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
