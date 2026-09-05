"use client";

import { useEffect, useState } from "react";

/** Keep the crew shell synchronized with the window after resize or restore. */
export function CrewViewport({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Keep layout pixels here: visualViewport.height shrinks on pinch zoom.
        const next = window.innerHeight;
        if (next > 0) setHeight(next);
      });
    };
    const viewport = window.visualViewport;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("pageshow", measure);
    viewport?.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pageshow", measure);
      viewport?.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <div
      data-crew-viewport
      className="fixed inset-x-0 top-0 h-dvh overflow-hidden bg-background flex flex-col pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      style={height === null ? undefined : { height }}
    >
      {children}
    </div>
  );
}
