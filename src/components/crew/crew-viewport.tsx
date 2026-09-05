"use client";

import { useEffect, useState } from "react";

/** Keep the crew shell synchronized with the window after resize or restore. */
export function CrewViewport({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState<number | "100vh" | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      if (document.visibilityState === "hidden") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Apple Home Screen windows can exclude safe areas from dynamic height
        // readings. Use the full viewport there (WebKit bug 254868); keep browser
        // tabs and Android on the measured window, without pinch-zoom shrinkage.
        const appleStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
        if (appleStandalone) setHeight("100vh");
        else if (window.innerHeight > 0) setHeight(window.innerHeight);
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
      className="crew-viewport fixed inset-x-0 top-0 overflow-hidden bg-background flex flex-col pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      style={height === null ? undefined : { height }}
    >
      {children}
    </div>
  );
}
