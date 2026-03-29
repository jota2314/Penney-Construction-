"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, X, ExternalLink, Download, ZoomIn, ZoomOut, RotateCcw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PDF pages with scroll + zoom controls.
 * Native scroll for panning, floating +/- for zoom (works on every browser).
 * Desktop also supports Ctrl+wheel zoom.
 */
export function PdfPages({ url, filename }: { url: string; filename?: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const zoomRef = useRef(100);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  function doZoom(newZoom: number) {
    const clamped = Math.min(Math.max(newZoom, 100), 400);
    zoomRef.current = clamped;
    setZoom(clamped);
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

  // Desktop: Ctrl+wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      doZoom(zoomRef.current + (-e.deltaY * 0.5));
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
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
    <div className="flex-1 relative overflow-hidden">
      {/* Scrollable PDF area */}
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-auto bg-[#1a1a1a]"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="p-3" style={{ width: `${zoom}%` }}>
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

      {/* Floating zoom controls — small pill at bottom center */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/70 backdrop-blur-sm rounded-full px-1.5 py-1 shadow-lg border border-white/10">
        <button
          onClick={() => doZoom(zoom - 50)}
          disabled={zoom <= 100}
          className="h-8 w-8 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <ZoomOut className="h-4 w-4" />
        </button>

        <span className="text-[11px] text-white/60 min-w-[3ch] text-center font-mono tabular-nums">
          {zoom === 100 ? "1x" : `${(zoom / 100).toFixed(1)}x`}
        </span>

        <button
          onClick={() => doZoom(zoom + 50)}
          disabled={zoom >= 400}
          className="h-8 w-8 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <ZoomIn className="h-4 w-4" />
        </button>

        {zoom > 100 && (
          <button
            onClick={() => doZoom(100)}
            className="h-8 w-8 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
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
    <div className="fixed inset-0 z-50 bg-[#1a1a1a] flex flex-col">
      {/* No header bar — just the PDF content filling the whole screen.
          This way browser pinch-to-zoom only zooms the PDF images. */}
      <PdfPages url={url} filename={filename} />

      {/* Big X close button — top left */}
      <button
        onClick={onClose}
        className="fixed top-3 left-3 z-[60] h-11 w-11 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-full shadow-lg border border-white/10 text-white hover:bg-black/80 transition-colors"
      >
        <X className="h-6 w-6" />
      </button>

      {/* Share & Download — top right */}
      <div className="fixed top-3 right-3 z-[60] flex items-center gap-2">
        <a
          href={url}
          download={filename}
          className="h-11 w-11 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-full shadow-lg border border-white/10 text-white/80 hover:text-white hover:bg-black/80 transition-colors"
        >
          <Download className="h-5 w-5" />
        </a>
        <button
          onClick={() => {
            if (navigator.share) {
              navigator.share({ title: filename || "PDF", url }).catch(() => {});
            } else {
              window.open(url, "_blank");
            }
          }}
          className="h-11 w-11 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-full shadow-lg border border-white/10 text-white/80 hover:text-white hover:bg-black/80 transition-colors"
        >
          <ExternalLink className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
