"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus, X } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSwipeCarousel } from "@/hooks/use-swipe-carousel";

interface ImageViewerProps {
  url: string | null;
  /** Optional gallery: when provided with 2+ images, swipe/arrows navigate between them. */
  urls?: string[];
  filename?: string;
  onClose: () => void;
}

// Capacitor can report a zero CSS safe-area inset while its status bar still
// overlays the WebView. Keep the control at least 4rem from the screen top so
// it always clears the clock, camera island, and battery area.
const CLOSE_BUTTON_TOP =
  "max(calc(env(safe-area-inset-top, 0px) + 0.75rem), 4rem)";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;

type Zoom = { s: number; x: number; y: number };
const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };

function distance(a: React.Touch, b: React.Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Full-screen image preview with a mobile-safe, easy-to-reach close control.
 *
 * Pass `urls` to browse a set of photos by swiping (or arrows / arrow keys).
 *
 * Zooming: pinch with two fingers, double-tap (or double-click), scroll wheel,
 * or the +/- buttons. Once zoomed in, one-finger drag pans the photo instead of
 * swiping to the next one, and the zoom resets whenever the photo changes — so
 * a crew member can pinch into a framing detail without losing the carousel.
 */
export function ImageViewer({ url, urls, filename = "Image preview", onClose }: ImageViewerProps) {
  const gallery = urls && urls.length > 0 ? urls : url ? [url] : [];
  const [idx, setIdx] = useState(0);
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  /** Buttons and double-tap ease into place; a live pinch or drag must not. */
  const [smooth, setSmooth] = useState(true);

  // The dialog body mounts a commit after `open` flips, so the viewport is
  // tracked as state — an effect keyed on a ref would attach its wheel listener
  // to a node that does not exist yet and never retry.
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const activeImgRef = useRef<HTMLImageElement | null>(null);
  const pinch = useRef<{ dist: number; s: number; ox: number; oy: number } | null>(null);
  const pan = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const tap = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  // On open (or when a different photo is tapped), start at that photo.
  if (url !== prevUrl) {
    setPrevUrl(url);
    setZoom(NO_ZOOM);
    if (url) {
      const i = gallery.indexOf(url);
      setIdx(i >= 0 ? i : 0);
    }
  }

  const open = !!url;
  const count = gallery.length;
  const clampedIdx = Math.min(idx, Math.max(0, count - 1));
  const zoomed = zoom.s > MIN_SCALE;

  const swipe = useSwipeCarousel({
    count,
    index: clampedIdx,
    onIndexChange: setIdx,
  });

  const prev = () => setIdx((i) => (i - 1 + count) % count);
  const next = () => setIdx((i) => (i + 1) % count);

  // A new photo always starts un-zoomed.
  const [prevIdx, setPrevIdx] = useState(clampedIdx);
  if (clampedIdx !== prevIdx) {
    setPrevIdx(clampedIdx);
    setSmooth(true);
    setZoom(NO_ZOOM);
  }

  /** Keep the photo's edges from being dragged past the middle of the screen. */
  const clampOffset = useCallback(
    (s: number, x: number, y: number) => {
      const img = activeImgRef.current;
      if (!img || !viewportEl) return { x, y };
      const maxX = Math.max(0, (img.clientWidth * s - viewportEl.clientWidth) / 2);
      const maxY = Math.max(0, (img.clientHeight * s - viewportEl.clientHeight) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, x)),
        y: Math.min(maxY, Math.max(-maxY, y)),
      };
    },
    [viewportEl],
  );

  /** Zoom to `nextScale`, keeping the point (ox, oy) — offset from the viewport
   *  centre in px — pinned under the finger / cursor. */
  const zoomTo = useCallback(
    (nextScale: number, ox = 0, oy = 0, animate = true) => {
      setSmooth(animate);
      setZoom((z) => {
        const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
        if (s === MIN_SCALE) return NO_ZOOM;
        const ratio = s / z.s;
        const { x, y } = clampOffset(s, ox - (ox - z.x) * ratio, oy - (oy - z.y) * ratio);
        return { s, x, y };
      });
    },
    [clampOffset, setSmooth, setZoom],
  );

  /** Pointer position relative to the viewport centre. */
  const toCentreOffset = useCallback(
    (clientX: number, clientY: number) => {
      const box = viewportEl?.getBoundingClientRect();
      if (!box) return { ox: 0, oy: 0 };
      return { ox: clientX - (box.left + box.width / 2), oy: clientY - (box.top + box.height / 2) };
    },
    [viewportEl],
  );

  const toggleZoomAt = useCallback(
    (clientX: number, clientY: number) => {
      const { ox, oy } = toCentreOffset(clientX, clientY);
      zoomTo(zoom.s > MIN_SCALE ? MIN_SCALE : DOUBLE_TAP_SCALE, ox, oy);
    },
    [toCentreOffset, zoom.s, zoomTo],
  );

  // Wheel zoom needs a non-passive listener — React's onWheel is passive, so
  // preventDefault() there would be ignored and the page would scroll behind.
  useEffect(() => {
    if (!viewportEl || !open) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { ox, oy } = toCentreOffset(e.clientX, e.clientY);
      setSmooth(false);
      setZoom((z) => {
        const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, z.s * Math.exp(-e.deltaY / 320)));
        if (s === MIN_SCALE) return NO_ZOOM;
        const ratio = s / z.s;
        const { x, y } = clampOffset(s, ox - (ox - z.x) * ratio, oy - (oy - z.y) * ratio);
        return { s, x, y };
      });
    };
    viewportEl.addEventListener("wheel", onWheel, { passive: false });
    return () => viewportEl.removeEventListener("wheel", onWheel);
  }, [open, viewportEl, clampOffset, toCentreOffset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (count > 1 && !zoomed) {
        if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + count) % count);
        if (e.key === "ArrowRight") setIdx((i) => (i + 1) % count);
      }
      if (e.key === "+" || e.key === "=") zoomTo(zoom.s + 0.5);
      if (e.key === "-" || e.key === "_") zoomTo(zoom.s - 0.5);
      if (e.key === "0") {
        setSmooth(true);
        setZoom(NO_ZOOM);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count, zoomed, zoom.s, zoomTo]);

  // ── Touch: pinch to zoom, drag to pan when zoomed, otherwise swipe ──
  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const { ox, oy } = toCentreOffset((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      pinch.current = { dist: distance(a, b) || 1, s: zoom.s, ox, oy };
      pan.current = null;
      tap.current = null;
      return;
    }
    const t = e.touches[0];
    tap.current = { t: Date.now(), x: t.clientX, y: t.clientY };
    if (zoomed) {
      pan.current = { px: t.clientX, py: t.clientY, ox: zoom.x, oy: zoom.y };
      return;
    }
    swipe.handlers.onTouchStart(e);
  };

  const onTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (pinch.current && e.touches.length >= 2) {
      const p = pinch.current;
      const d = distance(e.touches[0], e.touches[1]);
      zoomTo((p.s * d) / p.dist, p.ox, p.oy, false);
      return;
    }
    if (pan.current) {
      const p = pan.current;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - p.px, t.clientY - p.py) > 8) tap.current = null;
      setSmooth(false);
      setZoom((z) => ({ ...z, ...clampOffset(z.s, p.ox + (t.clientX - p.px), p.oy + (t.clientY - p.py)) }));
      return;
    }
    if (!zoomed) swipe.handlers.onTouchMove(e);
  };

  const onTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    if (pinch.current) {
      if (e.touches.length === 0) pinch.current = null;
      return;
    }
    if (pan.current) {
      pan.current = null;
    } else {
      swipe.handlers.onTouchEnd();
      swipe.consumeSwipe();
    }

    // Double-tap toggles zoom — a tap is a quick touch that barely moved.
    const start = tap.current;
    tap.current = null;
    if (!start || Date.now() - start.t > 300) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      toggleZoomAt(start.x, start.y);
    } else {
      lastTap.current = now;
    }
  };

  // ── Mouse: drag to pan when zoomed ──
  const onMouseDown = (e: React.MouseEvent) => {
    if (!zoomed || e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = zoom.x;
    const oy = zoom.y;
    const move = (ev: MouseEvent) => {
      setSmooth(false);
      setZoom((z) => ({ ...z, ...clampOffset(z.s, ox + (ev.clientX - startX), oy + (ev.clientY - startY)) }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="!fixed !inset-0 !top-0 !left-0 !h-[100dvh] !w-screen !max-w-none !translate-x-0 !translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-black p-0"
      >
        <DialogTitle className="sr-only">{filename}</DialogTitle>

        <div
          ref={setViewportEl}
          className="h-full w-full overflow-hidden"
          style={{
            touchAction: zoomed ? "none" : "pan-y",
            cursor: zoomed ? "grab" : "zoom-in",
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          onMouseDown={onMouseDown}
          onDoubleClick={(e) => toggleZoomAt(e.clientX, e.clientY)}
        >
          <div className="flex h-full" style={swipe.trackStyle}>
            {gallery.map((u, i) => {
              const active = i === clampedIdx;
              return (
                <div
                  key={`${u}-${i}`}
                  className="flex h-full w-full flex-shrink-0 items-center justify-center p-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={(el) => {
                      if (active) activeImgRef.current = el;
                    }}
                    src={u}
                    alt={count > 1 ? `${filename} (${i + 1} of ${count})` : filename}
                    draggable={false}
                    className="max-h-full max-w-full select-none object-contain"
                    style={
                      active && zoomed
                        ? {
                            transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.s})`,
                            transition: smooth ? "transform 160ms ease-out" : "none",
                            willChange: "transform",
                          }
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Zoom controls */}
        <div
          className="fixed right-3 z-[60] flex flex-col items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-1.5 py-2 backdrop-blur-sm"
          style={{ bottom: "max(calc(env(safe-area-inset-bottom, 0px) + 1.5rem), 3rem)" }}
        >
          <button
            type="button"
            onClick={() => zoomTo(zoom.s + 0.5)}
            aria-label="Zoom in"
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="text-[10px] font-semibold tabular-nums text-white/80">
            {Math.round(zoom.s * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomTo(zoom.s - 0.5)}
            aria-label="Zoom out"
            disabled={!zoomed}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 disabled:opacity-35"
          >
            <Minus className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              setSmooth(true);
              setZoom(NO_ZOOM);
            }}
            aria-label="Reset zoom"
            disabled={!zoomed}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 disabled:opacity-35"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {count > 1 && (
          <>
            <div
              style={{ top: CLOSE_BUTTON_TOP }}
              className="fixed left-1/2 z-[60] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[13px] font-semibold text-white backdrop-blur-sm"
            >
              {clampedIdx + 1}/{count}
            </div>
            {!zoomed && (
              <>
                <button
                  type="button"
                  onClick={prev}
                  aria-label="Previous photo"
                  className="fixed left-2 top-1/2 z-[60] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/85"
                >
                  <ChevronLeft className="h-6 w-6" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={next}
                  aria-label="Next photo"
                  className="fixed right-2 top-1/2 z-[60] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/85"
                >
                  <ChevronRight className="h-6 w-6" aria-hidden="true" />
                </button>
                <div
                  className="fixed bottom-0 left-1/2 z-[60] flex -translate-x-1/2 gap-1.5"
                  style={{ paddingBottom: "max(calc(env(safe-area-inset-bottom, 0px) + 0.75rem), 1.25rem)" }}
                  aria-hidden="true"
                >
                  {gallery.map((_, i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: i === clampedIdx ? "#fff" : "rgba(255,255,255,0.45)" }}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <DialogClose
          aria-label="Close image"
          style={{
            top: CLOSE_BUTTON_TOP,
            left: "calc(env(safe-area-inset-left, 0px) + 0.75rem)",
          }}
          className="fixed z-[60] flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          <X className="h-7 w-7" aria-hidden="true" />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
