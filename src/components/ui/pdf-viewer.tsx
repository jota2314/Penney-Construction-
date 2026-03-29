"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PdfViewerProps {
  url: string;
  filename?: string;
}

export function PdfViewer({ url, filename }: PdfViewerProps) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track pinch-to-zoom
  const lastDistRef = useRef<number | null>(null);
  const baseScaleRef = useRef(1);

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
        // Render at 2x for sharpness on mobile retina screens
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

  // Pinch-to-zoom handler
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastDistRef.current = Math.hypot(dx, dy);
        baseScaleRef.current = scale;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && lastDistRef.current !== null) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / lastDistRef.current;
        const newScale = Math.min(Math.max(baseScaleRef.current * ratio, 0.5), 4);
        setScale(newScale);
      }
    }

    function onTouchEnd() {
      lastDistRef.current = null;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [scale]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Rendering {filename || "PDF"}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Zoom controls */}
      <div className="flex items-center justify-center gap-1 py-1.5 border-b shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setScale((s) => Math.max(s - 0.25, 0.5))}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setScale((s) => Math.min(s + 0.25, 4))}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setScale(1)}
        >
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[10px] text-muted-foreground ml-1">
          {pages.length} page{pages.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Scrollable pages with pinch zoom */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-muted/30"
        style={{ touchAction: "pan-x pan-y" }}
      >
        <div
          className="flex flex-col items-center gap-2 p-2"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top center",
            width: scale > 1 ? `${100 / scale}%` : "100%",
          }}
        >
          {pages.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Page ${i + 1}`}
              className="w-full shadow-md rounded"
              draggable={false}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
