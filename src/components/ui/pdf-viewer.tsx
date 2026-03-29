"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, X, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Renders PDF pages as images. No wrapper — just the loading state + scrollable page images.
 * Use this inside your own layout when you need custom action buttons around the PDF.
 */
export function PdfPages({ url, filename }: { url: string; filename?: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      className="flex-1 overflow-auto bg-muted/20"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="flex flex-col items-center gap-3 p-3">
        {pages.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={`Page ${i + 1}`}
            className="w-full shadow-lg rounded-sm"
            draggable={false}
            style={{ touchAction: "pinch-zoom" }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Full-screen PDF viewer with header bar (close, open in browser, download).
 * Uses a plain fixed overlay (not a Dialog) so mobile pinch-to-zoom works natively.
 */
export function PdfViewer({ url, filename, onClose }: { url: string; filename?: string; onClose: () => void }) {
  // Prevent body scroll while viewer is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header bar */}
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

      {/* PDF pages */}
      <PdfPages url={url} filename={filename} />
    </div>
  );
}
