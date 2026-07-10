"use client";

import { X } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

interface ImageViewerProps {
  url: string | null;
  filename?: string;
  onClose: () => void;
}

/**
 * Full-screen image preview with a mobile-safe, easy-to-reach close control.
 */
export function ImageViewer({ url, filename = "Image preview", onClose }: ImageViewerProps) {
  return (
    <Dialog open={!!url} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="!fixed !inset-0 !top-0 !left-0 !h-[100dvh] !w-screen !max-w-none !translate-x-0 !translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-black p-0"
      >
        <DialogTitle className="sr-only">{filename}</DialogTitle>

        <div className="flex h-full w-full items-center justify-center p-3">
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={filename}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        <DialogClose
          aria-label="Close image"
          style={{
            top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
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
