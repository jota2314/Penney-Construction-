"use client";

import { useEffect, useState } from "react";

/** Keep the crew shell synchronized with the window after resize or restore. */
export function CrewViewport({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      if (document.visibilityState === "hidden") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Use the actual layout window on every platform. A full 100vh can
        // extend beyond an installed iPhone app's visible window and clip tabs.
        // Do not use visualViewport.height: pinch zoom shrinks that measurement.
        if (window.innerHeight > 0) setHeight(window.innerHeight);
      });
    };
    const viewport = window.visualViewport;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("pageshow", measure);
    document.addEventListener("visibilitychange", measure);
    viewport?.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pageshow", measure);
      document.removeEventListener("visibilitychange", measure);
      viewport?.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <div
      data-crew-viewport
      className="crew-viewport fixed inset-x-0 top-0 overflow-hidden bg-background flex flex-col"
      style={height === null ? undefined : { height }}
    >
      {children}
    </div>
  );
}
