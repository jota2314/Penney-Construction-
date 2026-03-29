"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, X, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PDF pages with pinch-to-zoom + native scroll.
 * Uses Safari GestureEvent (provides .scale directly) as primary zoom method,
 * with touch-distance fallback for Android/other browsers.
 * Images grow/shrink by changing container width — native overflow scroll
 * handles panning in all directions.
 */
export function PdfPages({ url, filename }: { url: string; filename?: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageWidth, setImageWidth] = useState(100);
  const widthRef = useRef(100);
  const gestureStartWidthRef = useRef(100);
  const pinchStartDistRef = useRef(0);
  const pinchStartWidthRef = useRef(100);
  const isPinchingRef = useRef(false);

  useEffect(() => { widthRef.current = imageWidth; }, [imageWidth]);

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

  useEffect(() => {
    renderPdf();
  }, [renderPdf]);

  // Safari GestureEvent — fires on iOS/macOS Safari with a .scale property
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onGestureStart(e: Event) {
      e.preventDefault();
      gestureStartWidthRef.current = widthRef.current;
    }

    function onGestureChange(e: Event) {
      e.preventDefault();
      const ge = e as Event & { scale: number };
      const newWidth = Math.min(Math.max(gestureStartWidthRef.current * ge.scale, 100), 500);
      widthRef.current = newWidth;
      setImageWidth(newWidth);
    }

    function onGestureEnd(e: Event) {
      e.preventDefault();
      if (widthRef.current < 110) {
        widthRef.current = 100;
        setImageWidth(100);
      }
    }

    container.addEventListener("gesturestart", onGestureStart, { passive: false } as AddEventListenerOptions);
    container.addEventListener("gesturechange", onGestureChange, { passive: false } as AddEventListenerOptions);
    container.addEventListener("gestureend", onGestureEnd, { passive: false } as AddEventListenerOptions);

    return () => {
      container.removeEventListener("gesturestart", onGestureStart);
      container.removeEventListener("gesturechange", onGestureChange);
      container.removeEventListener("gestureend", onGestureEnd);
    };
  }, []);

  // Touch-based pinch fallback (Android + browsers without GestureEvent)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function getDist(t1: Touch, t2: Touch) {
      return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        isPinchingRef.current = true;
        pinchStartDistRef.current = getDist(e.touches[0], e.touches[1]);
        pinchStartWidthRef.current = widthRef.current;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && isPinchingRef.current) {
        e.preventDefault();
        const dist = getDist(e.touches[0], e.touches[1]);
        const ratio = dist / pinchStartDistRef.current;
        const newWidth = Math.min(Math.max(pinchStartWidthRef.current * ratio, 100), 500);
        widthRef.current = newWidth;
        setImageWidth(newWidth);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2 && isPinchingRef.current) {
        isPinchingRef.current = false;
        if (widthRef.current < 110) {
          widthRef.current = 100;
          setImageWidth(100);
        }
      }
    }

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // Desktop: Ctrl+scroll to zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.5;
      const next = Math.min(Math.max(widthRef.current + delta, 100), 500);
      const final = next < 110 ? 100 : next;
      widthRef.current = final;
      setImageWidth(final);
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // Double-tap / double-click to reset
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastTap = 0;
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault();
        widthRef.current = 100;
        setImageWidth(100);
      }
      lastTap = now;
    }

    function onDblClick() {
      widthRef.current = 100;
      setImageWidth(100);
    }

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("dblclick", onDblClick);
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
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
        touchAction: "manipulation",
      }}
    >
      <div className="p-3" style={{ width: `${imageWidth}%` }}>
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
      {/* Header — fixed, never zooms */}
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
