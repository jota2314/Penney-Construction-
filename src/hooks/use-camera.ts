"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type FacingMode = "environment" | "user";

interface UseCameraOptions {
  /** Initial facing mode. Defaults to "environment" (rear camera). */
  initialFacingMode?: FacingMode;
  /** Whether to start the camera automatically on mount. Defaults to true. */
  autoStart?: boolean;
  /** JPEG quality for captured photos (0–1). Defaults to 0.85. */
  jpegQuality?: number;
  /** Ideal video width. Defaults to 1920. */
  idealWidth?: number;
  /** Ideal video height. Defaults to 1080. */
  idealHeight?: number;
}

interface UseCameraReturn {
  /** Ref to attach to the <video> element */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Ref to attach to a hidden <canvas> element (used for photo capture) */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Whether the camera stream is actively running */
  isActive: boolean;
  /** Current facing mode */
  facingMode: FacingMode;
  /** Error message if camera access failed, or null */
  error: string | null;
  /** Whether the flash effect is showing (true for ~150ms after capture) */
  flashEffect: boolean;
  /** Start (or restart) the camera. Optionally override facing mode. */
  startCamera: (facing?: FacingMode) => Promise<void>;
  /** Stop the camera and release the stream */
  stopCamera: () => void;
  /** Toggle between front and rear cameras */
  toggleFacingMode: () => Promise<void>;
  /** Capture a photo from the current video frame. Returns a JPEG Blob, or null on failure. */
  capturePhoto: () => Promise<Blob | null>;
}

export function useCamera(options: UseCameraOptions = {}): UseCameraReturn {
  const {
    initialFacingMode = "environment",
    autoStart = true,
    jpegQuality = 0.85,
    idealWidth = 1920,
    idealHeight = 1080,
  } = options;

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>(initialFacingMode);
  const [flashEffect, setFlashEffect] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(
    async (facing: FacingMode = facingMode) => {
      try {
        // Stop any existing stream first
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: idealWidth },
            height: { ideal: idealHeight },
          },
          audio: false,
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setIsActive(true);
        setError(null);
      } catch {
        setError("Could not access camera. Check permissions.");
        setIsActive(false);
      }
    },
    [facingMode, idealWidth, idealHeight]
  );

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
  }, []);

  const toggleFacingMode = useCallback(async () => {
    const newFacing: FacingMode =
      facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    await startCamera(newFacing);
  }, [facingMode, startCamera]);

  const capturePhoto = useCallback(async (): Promise<Blob | null> => {
    if (!videoRef.current || !canvasRef.current) return null;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);

    // Trigger flash effect
    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 150);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", jpegQuality)
    );

    return blob;
  }, [jpegQuality]);

  // Auto-start camera on mount + cleanup on unmount
  useEffect(() => {
    if (autoStart) {
      startCamera();
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    videoRef,
    canvasRef,
    isActive,
    facingMode,
    error,
    flashEffect,
    startCamera,
    stopCamera,
    toggleFacingMode,
    capturePhoto,
  };
}
