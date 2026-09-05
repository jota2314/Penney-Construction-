"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Only the content scrolls; header and navigation share the viewport shell. */
export function CrewScrollArea({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => { ref.current?.scrollTo({ top: 0, behavior: "instant" }); }, [pathname]);
  return <main ref={ref} className="min-h-0 flex-1 overflow-y-auto overscroll-none pb-6" style={{ WebkitOverflowScrolling: "touch" }}>{children}</main>;
}
