"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { fmtDate } from "@/lib/portal-kit/format";
import { useBodyScrollLock, useIsClient, useOverlayLayer } from "./sheet";
import { usePortalScopeClass } from "./theme";

/**
 * Full-screen photo viewer, copied from the client portal's PhotoViewer:
 * swipe on a phone (40px), the ‹ › buttons (48px) or the arrow keys to move
 * through every photo, wrapping at both ends; Esc or Close to leave. The
 * neighbours load in the background so a swipe feels instant. Renders on
 * <body> (above sheets) so iOS never clips it. Opened over a sheet, Esc
 * closes only the viewer, and focus returns to the photo that opened it.
 */

/** Anything with a full-size URL; `thumb` feeds PhotoGrid. SubPhoto fits as-is. */
export interface ViewerPhoto {
  full: string;
  thumb?: string;
  /** A day or timestamp, shown next to the counter. */
  date?: string | null;
}

const SWIPE_PX = 40;

export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: ViewerPhoto[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const scope = usePortalScopeClass();
  const isClient = useIsClient();
  const touchX = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = photos.length;
  useBodyScrollLock(true);
  useOverlayLayer(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (count === 0) return;
      if (e.key === "ArrowLeft") onIndex((index - 1 + count) % count);
      else if (e.key === "ArrowRight") onIndex((index + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onIndex]);

  // Take focus so the keys and a screen reader start in the viewer.
  useEffect(() => {
    if (isClient) rootRef.current?.focus({ preventScroll: true });
  }, [isClient]);

  const ph = photos[index];
  if (!isClient || !ph) return null;
  const prev = () => onIndex((index - 1 + count) % count);
  const next = () => onIndex((index + 1) % count);

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Photos"
      tabIndex={-1}
      className={`${scope} fixed inset-0 z-[110] flex flex-col outline-none`}
      // Inline, because .pc-portal's own paper/ink colours outrank utilities.
      style={{ background: "#000", color: "#fff" }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        if (start == null) return;
        const dx = e.changedTouches[0].clientX - start;
        if (dx > SWIPE_PX) prev();
        else if (dx < -SWIPE_PX) next();
      }}
    >
      <div className="flex items-center justify-between px-4 py-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <span className="text-[16px] font-bold">
          {index + 1} / {count}
          {ph.date && <span className="ml-2 font-semibold text-white/70">{fmtDate(ph.date, "")}</span>}
        </span>
        <button type="button" onClick={onClose} className="inline-flex min-h-[44px] items-center rounded-full bg-white/15 px-4 text-[16px] font-bold">
          Close
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2" style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={ph.full} src={ph.full} alt={`Photo ${index + 1}`} className="max-h-full max-w-full rounded-lg object-contain" />
        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={prev}
              className="absolute left-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-[26px] font-bold backdrop-blur"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={next}
              className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-[26px] font-bold backdrop-blur"
            >
              ›
            </button>
            {/* Warm the neighbours so swiping feels instant. */}
            <span className="hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photos[(index + 1) % count].full} alt="" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photos[(index - 1 + count) % count].full} alt="" />
            </span>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A 3-up grid of square thumbnails; a tap opens that photo. `startIndex`
 * offsets the indexes when several grids (one per day) share one viewer.
 */
export function PhotoGrid({
  photos,
  onOpen,
  startIndex = 0,
}: {
  photos: ViewerPhoto[];
  onOpen: (index: number) => void;
  startIndex?: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {photos.map((ph, i) => (
        <button
          key={`${startIndex + i}-${ph.full}`}
          type="button"
          onClick={() => onOpen(startIndex + i)}
          aria-label={`Open photo ${startIndex + i + 1}`}
          className="aspect-square overflow-hidden rounded-lg bg-[var(--line)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ph.thumb ?? ph.full} alt="" loading="lazy" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}
