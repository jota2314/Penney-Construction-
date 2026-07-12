"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useCanManageFeed } from "@/components/providers/feed-permissions-provider";
import { v } from "./tokens";

type DeleteResult = { ok: true } | { ok: false; error: string };

/**
 * Trash control shown only to feed managers (Jorge + Ryan). First tap arms an
 * inline "Delete?" confirm; second tap runs the server delete and hides the
 * card. Renders nothing for everyone else.
 */
export function FeedDeleteButton({
  onDelete,
  onDeleted,
  label = "post",
}: {
  onDelete: () => Promise<DeleteResult>;
  /** Called after a successful delete — parent hides the card. */
  onDeleted: () => void;
  label?: string;
}) {
  const canManage = useCanManageFeed();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canManage) return null;

  const runDelete = () => {
    setError(null);
    startTransition(async () => {
      const result = await onDelete();
      if (result.ok) {
        onDeleted();
        router.refresh();
      } else {
        setError(result.error);
        setConfirming(false);
      }
    });
  };

  if (confirming) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={runDelete}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-60"
          style={{ background: "rgba(239,68,68,0.16)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.4)" }}
          aria-label={`Confirm delete ${label}`}
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Delete
        </button>
        {!pending && (
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-full px-2 py-1 text-[11px] font-medium"
            style={{ color: v("muted") }}
            aria-label="Cancel delete"
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90"
        style={{ color: v("quiet") }}
        aria-label={`Delete ${label}`}
        title={`Delete ${label}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {error && (
        <span className="text-[10px]" style={{ color: "#fca5a5" }}>
          {error}
        </span>
      )}
    </div>
  );
}
