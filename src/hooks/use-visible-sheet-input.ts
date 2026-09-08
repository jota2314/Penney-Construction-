"use client";

import { useEffect } from "react";

/** Scroll the sheet body, never the page, after Safari pans/resizes for typing. */
export function useVisibleSheetInput(open: boolean, body: HTMLDivElement | null) {
  useEffect(() => {
    if (!open) return;
    if (!body) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const reveal = () => {
      const input = document.activeElement;
      if (!(input instanceof HTMLElement) || !body.contains(input) ||
        !input.matches("textarea, input:not([type=file]):not([type=checkbox]), select, [contenteditable=true]")) return;
      const box = body.getBoundingClientRect();
      const field = input.getBoundingClientRect();
      const top = Math.max(box.top, viewport?.offsetTop ?? 0) + 12;
      const bottom = Math.min(box.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)) - 12;
      if (bottom <= top) return;
      const delta = field.height > bottom - top || field.top < top
        ? field.top - top : Math.max(0, field.bottom - bottom);
      if (Math.abs(delta) > 1) body.scrollBy({ top: delta, behavior: "instant" });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      // Wait for the bottom sheet's React viewport styles and browser layout.
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(reveal); });
    };
    body.addEventListener("focusin", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(body);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      body.removeEventListener("focusin", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [open, body]);
}
