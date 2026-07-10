"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

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

/**
 * Full-screen image preview with a mobile-safe, easy-to-reach close control.
 * Pass `urls` to browse a set of photos by swiping (or arrows / arrow keys).
 */
export function ImageViewer({ url, urls, filename = "Image preview", onClose }: ImageViewerProps) {
  const gallery = urls && urls.length > 0 ? urls : url ? [url] : [];
  const [idx, setIdx] = useState(0);
  const [prevUrl, setPrevUrl] = useState<string | null>(null);

  // On open (or when a different photo is tapped), start at that photo.
  if (url !== prevUrl) {
    setPrevUrl(url);
    if (url) {
      const i = gallery.indexOf(url);
      setIdx(i >= 0 ? i : 0);
    }
  }

  const open = !!url;
  const count = gallery.length;
  const clampedIdx = Math.min(idx, Math.max(0, count - 1));

  const { handlers, trackStyle } = useSwipeCarousel({
    count,
    index: clampedIdx,
    onIndexChange: setIdx,
  });

  const prev = () => setIdx((i) => (i - 1 + count) % count);
  const next = () => setIdx((i) => (i + 1) % count);

  useEffect(() => {
    if (!open || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + count) % count);
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="!fixed !inset-0 !top-0 !left-0 !h-[100dvh] !w-screen !max-w-none !translate-x-0 !translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-black p-0"
      >
        <DialogTitle className="sr-only">{filename}</DialogTitle>

        <div
          className="h-full w-full overflow-hidden"
          style={{ touchAction: "pan-y" }}
          {...handlers}
        >
          <div className="flex h-full" style={trackStyle}>
            {gallery.map((u, i) => (
              <div
                key={`${u}-${i}`}
                className="flex h-full w-full flex-shrink-0 items-center justify-center p-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u}
                  alt={count > 1 ? `${filename} (${i + 1} of ${count})` : filename}
                  draggable={false}
                  className="max-h-full max-w-full select-none object-contain"
                />
              </div>
            ))}
          </div>
        </div>

        {count > 1 && (
          <>
            <div
              style={{ top: CLOSE_BUTTON_TOP }}
              className="fixed left-1/2 z-[60] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[13px] font-semibold text-white backdrop-blur-sm"
            >
              {clampedIdx + 1}/{count}
            </div>
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
