"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, X, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Renders PDF pages as images with custom pinch-to-zoom via CSS transforms.
 * Browser-level zoom is NOT used — we handle touch gestures ourselves
 * so only the PDF content scales, not the surrounding UI.
 */
export function PdfPages({ url, filename }: { url: string; filename?: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Zoom state
  const scaleRef = useRef(1);
  const originRef = useRef({ x: 0, y: 0 });
  const startDistRef = useRef(0);
  const startScaleRef = useRef(1);
  const [, forceRender] = useState(0);

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

  // Custom pinch-to-zoom touch handlers
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    function getDistance(t1: Touch, t2: Touch) {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function getMidpoint(t1: Touch, t2: Touch) {
      return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };
    }

    let isPinching = false;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        isPinching = true;
        startDistRef.current = getDistance(e.touches[0], e.touches[1]);
        startScaleRef.current = scaleRef.current;
        const mid = getMidpoint(e.touches[0], e.touches[1]);
        const rect = container!.getBoundingClientRect();
        originRef.current = {
          x: mid.x - rect.left + container!.scrollLeft,
          y: mid.y - rect.top + container!.scrollTop,
        };
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && isPinching) {
        e.preventDefault(); // prevent browser zoom
        const dist = getDistance(e.touches[0], e.touches[1]);
        const ratio = dist / startDistRef.current;
        const newScale = Math.min(Math.max(startScaleRef.current * ratio, 1), 5);
        scaleRef.current = newScale;

        if (content) {
          content.style.transformOrigin = `${originRef.current.x}px ${originRef.current.y}px`;
          content.style.transform = `scale(${newScale})`;
        }
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        isPinching = false;
        // If scale is back to ~1, reset cleanly
        if (scaleRef.current < 1.05) {
          scaleRef.current = 1;
          if (content) {
            content.style.transform = "scale(1)";
          }
        }
        forceRender((n) => n + 1);
      }
    }

    // Use passive: false so we can preventDefault on touchmove (critical for iOS)
    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });

    // Mouse wheel / trackpad zoom (desktop): Ctrl+scroll or pinch on trackpad
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return; // Only zoom when Ctrl is held (trackpad pinch sends ctrlKey)
      e.preventDefault();
      const delta = -e.deltaY * 0.01;
      const newScale = Math.min(Math.max(scaleRef.current + delta, 1), 5);
      scaleRef.current = newScale;

      const rect = container!.getBoundingClientRect();
      const ox = e.clientX - rect.left + container!.scrollLeft;
      const oy = e.clientY - rect.top + container!.scrollTop;

      if (content) {
        content.style.transformOrigin = `${ox}px ${oy}px`;
        content.style.transform = `scale(${newScale})`;
      }
      forceRender((n) => n + 1);
    }

    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("wheel", onWheel);
    };
  }, [pages]);

  // Double-tap to reset zoom (touch) + double-click to reset (mouse)
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    let lastTap = 0;
    function onDoubleTap(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault();
        scaleRef.current = 1;
        content!.style.transform = "scale(1)";
        forceRender((n) => n + 1);
      }
      lastTap = now;
    }

    function onDblClick() {
      scaleRef.current = 1;
      content!.style.transform = "scale(1)";
      forceRender((n) => n + 1);
    }

    container.addEventListener("touchstart", onDoubleTap, { passive: false });
    container.addEventListener("dblclick", onDblClick);
    return () => {
      container.removeEventListener("touchstart", onDoubleTap);
      container.removeEventListener("dblclick", onDblClick);
    };
  }, [pages]);

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
      style={{ touchAction: "pan-x pan-y" }}
    >
      <div ref={contentRef} className="p-3" style={{ transformOrigin: "0 0" }}>
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
 * Full-screen PDF viewer with header bar.
 * Header stays fixed and never zooms. Only the PDF content below
 * responds to pinch-to-zoom via CSS transforms.
 */
export function PdfViewer({ url, filename, onClose }: { url: string; filename?: string; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";

    // Disable browser-level pinch-to-zoom so our custom transform zoom works.
    // iOS Safari ignores touch-action CSS — the viewport meta is the only way.
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

    // Also prevent gesture events (Safari pinch)
    function preventGesture(e: Event) { e.preventDefault(); }
    document.addEventListener("gesturestart", preventGesture, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gesturechange", preventGesture, { passive: false } as AddEventListenerOptions);

    return () => {
      document.body.style.overflow = "";
      // Restore original viewport
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
      {/* Header — stays fixed, never zooms */}
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

      {/* PDF content — only this zooms via touch gestures */}
      <PdfPages url={url} filename={filename} />
    </div>
  );
}
