"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, X, ExternalLink, Download, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Minimal structural types for the bits of pdf.js we touch, so this file does
// not depend on pdfjs-dist's types at build time (it's a dynamic import).
interface RenderTaskLike {
  promise: Promise<void>;
  cancel: () => void;
}
interface PdfPageLike {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: unknown): RenderTaskLike;
}
interface PdfDocLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy?: () => Promise<void>;
}

/**
 * One page, rendered only while it's near the viewport.
 *
 * Renders straight into a <canvas> — never `toDataURL()`. PNG-encoding a
 * full-size architectural sheet is slow, blocks the main thread, and the
 * resulting base64 string is far larger than the pixels it came from. Pages
 * that scroll well out of view release their backing store so a 16-sheet set
 * doesn't sit in memory all at once.
 */
function LazyPdfPage({
  doc,
  pageNumber,
  aspect,
  targetWidth,
}: {
  doc: PdfDocLike;
  pageNumber: number;
  aspect: number;
  targetWidth: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTaskLike | null>(null);
  const renderedWidthRef = useRef(0);
  const [visible, setVisible] = useState(false);

  // Start work a screen early so scrolling feels continuous.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: "1000px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!visible) {
      taskRef.current?.cancel();
      taskRef.current = null;
      if (renderedWidthRef.current) {
        canvas.width = 0;
        canvas.height = 0;
        renderedWidthRef.current = 0;
      }
      return;
    }

    if (targetWidth <= 0) return;

    // Already rendered at a close-enough resolution — don't redo it on every
    // small zoom nudge.
    const prev = renderedWidthRef.current;
    if (prev && Math.abs(targetWidth - prev) / prev < 0.25) return;

    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, targetWidth / base.width);
      const viewport = page.getViewport({ scale });

      taskRef.current?.cancel();
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const task = page.render({ canvasContext: ctx, viewport, canvas });
      taskRef.current = task;
      try {
        await task.promise;
        if (!cancelled) renderedWidthRef.current = targetWidth;
      } catch {
        /* superseded by a newer render, or unmounted */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, targetWidth, visible]);

  useEffect(() => () => taskRef.current?.cancel(), []);

  return (
    <div
      ref={wrapRef}
      className="mb-3 w-full rounded shadow-lg bg-white/5"
      style={{ aspectRatio: String(aspect) }}
    >
      <canvas ref={canvasRef} className="block w-full h-full rounded" />
    </div>
  );
}

/**
 * PDF pages with scroll + zoom controls.
 * Native scroll for panning, floating +/- for zoom (works on every browser).
 * Desktop also supports Ctrl+wheel zoom.
 */
export function PdfPages({ url, filename, topInset }: { url: string; filename?: string; topInset?: string }) {
  const [doc, setDoc] = useState<PdfDocLike | null>(null);
  const [aspects, setAspects] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const zoomRef = useRef(100);
  const [containerWidth, setContainerWidth] = useState(0);
  const [dpr, setDpr] = useState(1);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Cap DPR at 2 — 3x phone screens otherwise triple the pixels for no
  // visible gain on a drawing.
  useEffect(() => { setDpr(Math.min(window.devicePixelRatio || 1, 2)); }, []);

  function doZoom(newZoom: number) {
    const clamped = Math.min(Math.max(newZoom, 100), 400);
    zoomRef.current = clamped;
    setZoom(clamped);
  }

  // Load the document and collect page aspect ratios. `getPage` only parses
  // the page dictionary — it's the render that's expensive — so this is cheap
  // and lets every page reserve correct space immediately.
  useEffect(() => {
    let cancelled = false;
    let opened: PdfDocLike | null = null;

    (async () => {
      setLoading(true);
      setError(null);
      setDoc(null);
      setAspects([]);
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const loaded = (await pdfjsLib.getDocument(url).promise) as unknown as PdfDocLike;
        if (cancelled) {
          loaded.destroy?.();
          return;
        }
        opened = loaded;

        const pages = await Promise.all(
          Array.from({ length: loaded.numPages }, (_, i) => loaded.getPage(i + 1)),
        );
        if (cancelled) return;

        setAspects(pages.map((p) => {
          const v = p.getViewport({ scale: 1 });
          return v.height > 0 ? v.width / v.height : 1;
        }));
        setDoc(loaded);
      } catch (err) {
        console.error("PDF render error:", err);
        if (!cancelled) setError("Could not render PDF. Try Open in Browser.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      opened?.destroy?.();
    };
  }, [url]);

  // Track the scroll container's width so pages render at the resolution
  // they're actually displayed at.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, error]);

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
  }, [loading, error]);

  const targetWidth = containerWidth > 0
    ? Math.round(Math.min(4000, Math.max(800, containerWidth * dpr * (zoom / 100))))
    : 0;

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Opening {filename || "PDF"}...</p>
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
        style={{ WebkitOverflowScrolling: "touch", paddingTop: topInset }}
      >
        <div className="p-3" style={{ width: `${zoom}%` }}>
          {doc && aspects.map((aspect, i) => (
            <LazyPdfPage
              key={i}
              doc={doc}
              pageNumber={i + 1}
              aspect={aspect}
              targetWidth={targetWidth}
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

  // Buttons sit below the iOS status bar / notch (safe-area inset), and the PDF
  // content reserves matching top space so the first page (company header) is
  // never hidden behind the floating controls.
  const controlsTop = "calc(env(safe-area-inset-top, 0px) + 0.75rem)";
  const contentTopInset = "calc(env(safe-area-inset-top, 0px) + 3.75rem)";

  return (
    <div className="fixed inset-0 z-50 bg-[#1a1a1a] flex flex-col">
      {/* No header bar — just the PDF content filling the whole screen.
          This way browser pinch-to-zoom only zooms the PDF images. The
          topInset keeps the first page clear of the floating controls. */}
      <PdfPages url={url} filename={filename} topInset={contentTopInset} />

      {/* Big X close button — top left */}
      <button
        onClick={onClose}
        style={{ top: controlsTop }}
        className="fixed left-3 z-[60] h-11 w-11 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-full shadow-lg border border-white/10 text-white hover:bg-black/80 transition-colors"
      >
        <X className="h-6 w-6" />
      </button>

      {/* Share & Download — top right */}
      <div style={{ top: controlsTop }} className="fixed right-3 z-[60] flex items-center gap-2">
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
