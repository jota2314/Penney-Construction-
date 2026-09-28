"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Not in the TS DOM lib yet. Chrome/Edge on Android ship it; Safari (and so
// every iPhone browser) does not — there the button hides and the typed /
// Bluetooth-scanner box next to it still works.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new () => BarcodeDetectorLike;

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return ctor ?? null;
}

/** Camera barcode scan. Renders nothing where the browser can't detect barcodes. */
export function ScanCodeButton({ onCode }: { onCode: (code: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSupported(!!getDetectorCtor() && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  if (!supported) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        title="Scan a barcode"
        onClick={() => setOpen(true)}
      >
        <ScanLine className="h-4 w-4" />
      </Button>
      {open && (
        <ScannerDialog
          onClose={() => setOpen(false)}
          onCode={(code) => {
            setOpen(false);
            onCode(code);
          }}
        />
      )}
    </>
  );
}

function ScannerDialog({
  onClose,
  onCode,
}: {
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Latest callback without restarting the camera when the parent re-renders.
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;

    (async () => {
      const Ctor = getDetectorCtor();
      if (!Ctor) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        setError("Couldn't open the camera. Check the camera permission.");
        return;
      }
      if (done) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});

      const detector = new Ctor();
      timer = setInterval(async () => {
        if (done || video.readyState < 2) return;
        try {
          const codes = await detector.detect(video);
          const hit = codes.find((c) => c.rawValue?.trim());
          if (hit && !done) {
            done = true;
            onCodeRef.current(hit.rawValue.trim());
          }
        } catch {
          // A frame that fails to decode is normal — keep looking.
        }
      }, 300);
    })();

    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Scan barcode</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : (
          <div className="overflow-hidden rounded-md bg-black">
            <video ref={videoRef} playsInline muted className="w-full" />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Hold the barcode inside the frame. It picks it up on its own.
        </p>
      </DialogContent>
    </Dialog>
  );
}
