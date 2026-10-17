"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markSignPosted } from "@/lib/actions/site-signs";
import { fmtShort } from "@/lib/portal-kit/format";

/**
 * The "Sign is up" tick for one job (office, screen only). Tap once the PM
 * has taped the sign at the entry door; tap again to clear it.
 */
export function SignPostedTick({
  projectId,
  postedAt,
  postedBy,
}: {
  projectId: string;
  postedAt: string | null;
  postedBy: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState({ postedAt, postedBy });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const posted = !!state.postedAt;

  function toggle() {
    setError(null);
    startTransition(async () => {
      const res = await markSignPosted(projectId, !posted);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setState({ postedAt: res.postedAt, postedBy: res.postedBy });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5 text-right">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={posted}
        title={posted ? "Tap to clear" : "Tap once the sign is taped up at the job"}
        className={`inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-sm font-semibold disabled:opacity-60 ${
          posted
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : "border-stone-300 bg-white text-stone-800 hover:bg-stone-50"
        }`}
      >
        <span aria-hidden>{posted ? "✓" : "○"}</span>
        {pending ? "Saving…" : "Sign is up"}
      </button>
      {posted && (
        <span className="text-xs text-stone-500">
          {fmtShort(state.postedAt, "")}
          {state.postedBy ? ` · ${state.postedBy}` : ""}
        </span>
      )}
      {error && <span className="text-xs font-medium text-red-700">{error}</span>}
    </div>
  );
}

/** Print the whole run (screen-only toolbar button). */
export function PrintSignsButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-amber-600 px-3.5 text-sm font-semibold text-white hover:bg-amber-700"
    >
      {label}
    </button>
  );
}
