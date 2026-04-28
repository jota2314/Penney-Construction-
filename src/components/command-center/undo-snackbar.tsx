"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface UndoSnackbarProps {
  open: boolean;
  message: string;
  /** Milliseconds before commit fires. Default 3000. */
  durationMs?: number;
  /** Called when the undo window expires without an undo tap. */
  onCommit: () => void;
  /** Called when the user taps Undo. */
  onUndo: () => void;
}

/**
 * 3-second "Sending… Undo" snackbar. Fixed at the bottom of the screen.
 * The actual side-effect (Gmail send) only fires after `durationMs` if the
 * user doesn't tap Undo first.
 */
export function UndoSnackbar({
  open,
  message,
  durationMs = 3000,
  onCommit,
  onUndo,
}: UndoSnackbarProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) {
      setProgress(0);
      return;
    }
    setProgress(0);
    const start = Date.now();
    const tick = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / durationMs) * 100);
      setProgress(pct);
    }, 50);
    const commit = setTimeout(() => {
      clearInterval(tick);
      onCommit();
    }, durationMs);
    return () => {
      clearInterval(tick);
      clearTimeout(commit);
    };
    // We intentionally leave onCommit out of deps so the timer doesn't reset
    // if the parent re-renders. open + duration changes are the only triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, durationMs]);

  if (!open) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-sm">
      <div className="rounded-xl bg-foreground text-background shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin opacity-70" />
            {message}
          </div>
          <button
            onClick={onUndo}
            className="text-sm font-semibold text-amber-400 hover:text-amber-300 uppercase tracking-wide"
          >
            Undo
          </button>
        </div>
        <div className="h-0.5 bg-background/20">
          <div
            className="h-full bg-amber-400 transition-[width] duration-75 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
