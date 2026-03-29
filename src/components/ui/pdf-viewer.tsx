"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, X, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PDF pages with pinch-to-zoom + native scroll.
 * Uses multiple strategies for maximum browser compatibility:
 * 1. Safari GestureEvent (iOS Safari + possibly Chrome iOS)
 * 2. Touch events with preventDefault on touchstart (Chrome iOS / Android)
 * 3. Ctrl+wheel (Desktop)
 */
export function PdfPages({ url, filename }: { url: string; filename?: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [imageWidth, setImageWidth] = useState(100);
  const widthRef = useRef(100);

  // Pinch state
  const pinchRef = useRef({
    active: false,
    startDist: 0,
    startWidth: 100,
  });

  useEffect(() => { widthRef.current = imageWidth; }, [imageWidth]);

  function updateWidth(w: number) {
    const clamped = Math.min(Math.max(w, 100), 500);
    const final = clamped < 110 ? 100 : clamped;
    widthRef.current = final;
    setImageWidth(final);
  }

  const renderPdf = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      const pdf = await pdfjsLib.getDocument(url).promise;
      const rendered: string[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
        rendered.push(canvas.toDataURL("image/png"));
      }

      setPages(rendered);
    } catch (err) {
      console.error("PDF render error:", err);
      setError("Could not render PDF. Try Open in Browser.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { renderPdf(); }, [renderPdf]);

  // All gesture/touch/scroll handlers in a single effect
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Safari GestureEvent (works on iOS Safari + Chrome iOS via WKWebView) ──
    let gestureStartWidth = 100;

    function onGestureStart(e: Event) {
      e.preventDefault();
      gestureStartWidth = widthRef.current;
    }

    function onGestureChange(e: Event) {
      e.preventDefault();
      const ge = e as Event & { scale: number };
      const newWidth = gestureStartWidth * ge.scale;
      widthRef.current = Math.min(Math.max(newWidth, 100), 500);
      setImageWidth(widthRef.current);
    }

    function onGestureEnd(e: Event) {
      e.preventDefault();
      updateWidth(widthRef.current);
    }

    // ── Touch events (fallback if GestureEvent not available) ──
    function getDist(t1: Touch, t2: Touch) {
      return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        // CRITICAL: preventDefault here stops the browser from claiming the pinch gesture
        e.preventDefault();
        pinchRef.current = {
          active: true,
          startDist: getDist(e.touches[0], e.touches[1]),
          startWidth: widthRef.current,
        };
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && pinchRef.current.active) {
        e.preventDefault();
        const dist = getDist(e.touches[0], e.touches[1]);
        const ratio = dist / pinchRef.current.startDist;
        const newWidth = pinchRef.current.startWidth * ratio;
        widthRef.current = Math.min(Math.max(newWidth, 100), 500);
        setImageWidth(widthRef.current);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2 && pinchRef.current.active) {
        pinchRef.current.active = false;
        updateWidth(widthRef.current);
      }
    }

    // ── Double-tap to reset ──
    let lastTap = 0;
    function onDoubleTap(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault();
        updateWidth(100);
      }
      lastTap = now;
    }

    // ── Desktop: Ctrl+wheel zoom ──
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.5;
      updateWidth(widthRef.current + delta);
    }

    // ── Desktop: double-click to reset ──
    function onDblClick() {
      updateWidth(100);
    }

    // Register everything — ALL touch listeners must be passive:false
    // so we can preventDefault and stop the browser from hijacking gestures
    container.addEventListener("gesturestart", onGestureStart, { passive: false } as AddEventListenerOptions);
    container.addEventListener("gesturechange", onGestureChange, { passive: false } as AddEventListenerOptions);
    container.addEventListener("gestureend", onGestureEnd, { passive: false } as AddEventListenerOptions);
    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchstart", onDoubleTap, { passive: false });
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("dblclick", onDblClick);

    return () => {
      container.removeEventListener("gesturestart", onGestureStart);
      container.removeEventListener("gesturechange", onGestureChange);
      container.removeEventListener("gestureend", onGestureEnd);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchstart", onDoubleTap);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("dblclick", onDblClick);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Rendering {filename || "PDF"}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground px-4">
        <p className="text-sm text-center">{error}</p>
        <Button variant="outline" size="sm" onClick={() => window.open(url, "_blank")}>
          Open in Browser
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-[#1a1a1a]"
      style={{
        WebkitOverflowScrolling: "touch",
        touchAction: "none", // Take full control of ALL touch — we handle scroll + zoom in JS
      }}
    >
      <div
        ref={contentRef}
        className="p-3"
        style={{ width: `${imageWidth}%`, minHeight: "100%" }}
      >
        {pages.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={`Page ${i + 1}`}
            className="w-full block mb-3 rounded shadow-lg"
            draggable={false}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Full-screen PDF viewer with fixed header.
 */
export function PdfViewer({ url, filename, onClose }: { url: string; filename?: string; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-background shrink-0">
        <p className="text-sm font-medium truncate flex-1 mr-2">
          {filename || "PDF"}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open(url, "_blank")}>
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <a href={url} download={filename}>
              <Download className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <PdfPages url={url} filename={filename} />
    </div>
  );
}
