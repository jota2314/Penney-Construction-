"use client";

import { useEffect } from "react";

/** Refresh open operational screens after another screen changes a schedule.
 * Pause while hidden or editing so drafts are not interrupted. */
export function useVisibleRefresh(refresh: () => void, milliseconds = 30_000) {
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== "visible") return;
      const editing = document.activeElement?.matches("input, textarea, select, [contenteditable=true]");
      const draftOrDialog = document.querySelector('[data-refresh-paused="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open]');
      if (!editing && !draftOrDialog) refresh();
    };
    const interval = window.setInterval(update, milliseconds);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh, milliseconds]);
}
