"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, X, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PDF pages with pinch-to-zoom + drag-to-pan.
 * Uses CSS transform: translate() scale() so only the PDF content moves/zooms.
 */
export function PdfPages({ url, filename }: { url: string; filename?: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Transform state: scale + translate
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const [cursorStyle, setCursorStyle] = useState<"default" | "grab" | "grabbing">("default");

  // Touch tracking
  const startDistRef = useRef(0);
  const startScaleRef = useRef(1);
  const startTxRef = useRef(0);
  const startTyRef = useRef(0);
  const startMidRef = useRef({ x: 0, y: 0 });
  const isPinchingRef = useRef(false);
  const isDraggingTouchRef = useRef(false);
  const touchStartRef = useRef({ x: 0, y: 0 });

  // Mouse drag tracking
  const isMouseDragRef = useRef(false);
  const mouseStartRef = useRef({ x: 0, y: 0 });
  const mouseTxStartRef = useRef(0);
  const mouseTyStartRef = useRef(0);

  function applyTransform() {
    const content = contentRef.current;
    if (!content) return;
    content.style.transform = `translate(${txRef.current}px, ${tyRef.current}px) scale(${scaleRef.current})`;
  }

  function resetTransform() {
    scaleRef.current = 1;
    txRef.current = 0;
    tyRef.current = 0;
    applyTransform();
    setCursorStyle("default");
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

  useEffect(() => {
    renderPdf();
  }, [renderPdf]);

  // Touch: pinch-to-zoom + single-finger pan
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        // Pinch start
        isPinchingRef.current = true;
        isDraggingTouchRef.current = false;
        startDistRef.current = getDistance(e.touches[0], e.touches[1]);
        startScaleRef.current = scaleRef.current;
        startTxRef.current = txRef.current;
        startTyRef.current = tyRef.current;
        startMidRef.current = getMidpoint(e.touches[0], e.touches[1]);
      } else if (e.touches.length === 1 && scaleRef.current > 1.05) {
        // Single finger pan (only when zoomed in)
        isDraggingTouchRef.current = true;
        touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        startTxRef.current = txRef.current;
        startTyRef.current = tyRef.current;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && isPinchingRef.current) {
        e.preventDefault();
        const dist = getDistance(e.touches[0], e.touches[1]);
        const mid = getMidpoint(e.touches[0], e.touches[1]);
        const newScale = Math.min(Math.max(startScaleRef.current * (dist / startDistRef.current), 1), 5);

        // Pan while pinching (follow the midpoint)
        const midDx = mid.x - startMidRef.current.x;
        const midDy = mid.y - startMidRef.current.y;

        scaleRef.current = newScale;
        txRef.current = startTxRef.current + midDx;
        tyRef.current = startTyRef.current + midDy;
        applyTransform();
      } else if (e.touches.length === 1 && isDraggingTouchRef.current) {
        e.preventDefault();
        const dx = e.touches[0].clientX - touchStartRef.current.x;
        const dy = e.touches[0].clientY - touchStartRef.current.y;
        txRef.current = startTxRef.current + dx;
        tyRef.current = startTyRef.current + dy;
        applyTransform();
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        isPinchingRef.current = false;
      }
      if (e.touches.length === 0) {
        isDraggingTouchRef.current = false;
        // If zoomed back to ~1, snap to reset
        if (scaleRef.current < 1.05) {
          resetTransform();
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
  }, [pages]);

  // Mouse: click-drag to pan + ctrl+wheel to zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onMouseDown(e: MouseEvent) {
      if (scaleRef.current <= 1.05) return; // Only pan when zoomed
      e.preventDefault();
      isMouseDragRef.current = true;
      mouseStartRef.current = { x: e.clientX, y: e.clientY };
      mouseTxStartRef.current = txRef.current;
      mouseTyStartRef.current = tyRef.current;
      setCursorStyle("grabbing");
    }

    function onMouseMove(e: MouseEvent) {
      if (!isMouseDragRef.current) return;
      const dx = e.clientX - mouseStartRef.current.x;
      const dy = e.clientY - mouseStartRef.current.y;
      txRef.current = mouseTxStartRef.current + dx;
      tyRef.current = mouseTyStartRef.current + dy;
      applyTransform();
    }

    function onMouseUp() {
      if (isMouseDragRef.current) {
        isMouseDragRef.current = false;
        setCursorStyle(scaleRef.current > 1.05 ? "grab" : "default");
      }
    }

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.01;
      const oldScale = scaleRef.current;
      const newScale = Math.min(Math.max(oldScale + delta, 1), 5);

      // Zoom toward cursor position
      const rect = container!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const ratio = newScale / oldScale;
      txRef.current = cx - ratio * (cx - txRef.current);
      tyRef.current = cy - ratio * (cy - tyRef.current);
      scaleRef.current = newScale;

      if (newScale <= 1.05) {
        resetTransform();
      } else {
        applyTransform();
        setCursorStyle("grab");
      }
    }

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("wheel", onWheel);
    };
  }, [pages]);

  // Double-tap (touch) or double-click (mouse) to reset zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastTap = 0;
    function onDoubleTap(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault();
        resetTransform();
      }
      lastTap = now;
    }

    function onDblClick() {
      resetTransform();
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
      className="flex-1 overflow-hidden bg-[#1a1a1a]"
      style={{
        touchAction: "none",
        cursor: cursorStyle,
      }}
    >
      <div
        ref={contentRef}
        className="p-3"
        style={{ transformOrigin: "0 0", willChange: "transform" }}
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
 * Full-screen PDF viewer with header bar.
 * Header stays fixed and never zooms/pans. Only the PDF content below responds.
 */
export function PdfViewer({ url, filename, onClose }: { url: string; filename?: string; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";

    // Disable browser-level pinch-to-zoom so our custom transform zoom works.
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

    // Block Safari gesture events
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
      {/* Header — stays fixed, never zooms or pans */}
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

      {/* PDF content — zoom + pan only affects this area */}
      <PdfPages url={url} filename={filename} />
    </div>
  );
}
