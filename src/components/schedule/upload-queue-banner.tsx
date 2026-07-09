"use client";

import { useEffect, useState } from "react";
import { Loader2, CloudUpload } from "lucide-react";
import { subscribeUploadQueue, type QueueState } from "@/lib/upload/daily-log-upload-queue";

/**
 * Floating banner that shows daily-log photo upload progress. Mounts
 * once at the layout root so users see uploads continuing as they
 * navigate away from the composer.
 */
export function UploadQueueBanner() {
  const [state, setState] = useState<QueueState>({ pending: 0, inFlight: 0, total: 0, completed: 0, failed: 0 });

  useEffect(() => {
    const unsubscribe = subscribeUploadQueue(setState);
    return unsubscribe;
  }, []);

  const uploading = state.pending + state.inFlight > 0;
  // Once drained, keep failures on screen (the queue clears them after a delay).
  if (!uploading && state.failed === 0) return null;

  const done = state.completed;
  const total = state.total;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 rounded-full bg-zinc-900/95 backdrop-blur-md border px-4 py-2 shadow-xl shadow-black/40 ${
        state.failed > 0 && !uploading ? "border-red-500/50" : "border-amber-500/40"
      }`}
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0.5rem))" }}
    >
      <CloudUpload className={`h-4 w-4 ${state.failed > 0 && !uploading ? "text-red-400" : "text-amber-400"}`} />
      {uploading ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
          <span className="text-xs font-medium text-zinc-100">Uploading photos — keep the app open</span>
          <span className="font-mono text-xs text-amber-400 tabular-nums">
            {done}/{total}
          </span>
          <span className="text-[10px] text-zinc-500 tabular-nums">{pct}%</span>
        </>
      ) : (
        <span className="text-xs font-medium text-red-300">
          {state.failed} photo{state.failed > 1 ? "s" : ""} didn&apos;t upload — try again on better signal
        </span>
      )}
      {uploading && state.failed > 0 && (
        <span className="text-[10px] font-medium text-red-400">{state.failed} failed</span>
      )}
    </div>
  );
}
