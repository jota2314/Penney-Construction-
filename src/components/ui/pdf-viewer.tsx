"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, X, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PDF pages with pinch-to-zoom + native scroll.
 * Instead of CSS transforms, we scale the actual image width so the container
 * scrolls naturally in all directions when zoomed in.
 */
export function PdfPages({ url, filename }: { url: string; filename?: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageWidth, setImageWidth] = useState(100); // percentage
  const widthRef = useRef(100); // always-current width for touch handlers

  // Keep ref in sync with state
  useEffect(() => { widthRef.current = imageWidth; }, [imageWidth]);

  // Pinch tracking
  const pinchRef = useRef({
    active: false,
    startDist: 0,
    startWidth: 100,
  });

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

  // Pinch-to-zoom: changes image width percentage → native scroll handles panning
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function getDist(t1: Touch, t2: Touch) {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
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
        const newWidth = Math.min(Math.max(pinchRef.current.startWidth * ratio, 100), 500);
        widthRef.current = newWidth;
        setImageWidth(newWidth);
      }
    }

    function onTouchEnd() {
      if (pinchRef.current.active) {
        pinchRef.current.active = false;
        // Snap back to 100% if close
        const w = widthRef.current;
        if (w < 110) {
          widthRef.current = 100;
          setImageWidth(100);
        }
      }
    }

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, []); // No deps — listeners registered once, use refs for current values

  // Desktop: Ctrl+scroll to zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setImageWidth((w) => {
        const delta = -e.deltaY * 0.5;
        const next = Math.min(Math.max(w + delta, 100), 500);
        return next < 110 ? 100 : next;
      });
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // Double-tap / double-click to reset zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastTap = 0;
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault();
        setImageWidth(100);
      }
      lastTap = now;
    }

    function onDblClick() {
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
      style={{ WebkitOverflowScrolling: "touch" }}
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
 * Header never zooms/scrolls. PDF content scrolls and zooms naturally below it.
 */
export function PdfViewer({ url, filename, onClose }: { url: string; filename?: string; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";

    // Disable browser-level pinch zoom so our custom zoom works
    let viewportMeta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    const originalContent = viewportMeta?.getAttribute("content") || "";
    if (!viewportMeta) {
      viewportMeta = document.createElement("meta");
      viewportMeta.name = "viewport";
      document.head.appendChild(viewportMeta);
    }
    viewportMeta.setAttribute(
      "content",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    );

    function preventGesture(e: Event) { e.preventDefault(); }
    document.addEventListener("gesturestart", preventGesture, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gesturechange", preventGesture, { passive: false } as AddEventListenerOptions);

    return () => {
      document.body.style.overflow = "";
      if (viewportMeta) {
        if (originalContent) {
          viewportMeta.setAttribute("content", originalContent);
        } else {
          viewportMeta.remove();
        }
      }
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header — fixed, never scrolls or zooms */}
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

      {/* PDF content — scrolls and zooms independently */}
      <PdfPages url={url} filename={filename} />
    </div>
  );
}
