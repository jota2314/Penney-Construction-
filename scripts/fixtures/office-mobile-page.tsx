"use client";

import { useState } from "react";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function OfficeMobileFixture() {
  const [shortList, setShortList] = useState(false);

  return (
    <SidebarProvider data-browser-safe-viewport>
      <aside data-testid="desktop-sidebar" className="hidden w-56 shrink-0 md:block">Office</aside>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2">
          <input aria-label="Search projects" placeholder="Search projects" />
          <button onClick={() => setShortList(!shortList)}>Change list length</button>
        </header>
        <div data-testid="project-scroll" className="flex flex-1 flex-col gap-4 overflow-auto p-4">
          <div className="grid gap-4">
            {Array.from({ length: shortList ? 1 : 30 }, (_, i) => (
              <article key={i} className="h-40 rounded-xl border p-4">Sample project {i + 1}</article>
            ))}
          </div>
        </div>
      </SidebarInset>
      <MobileBottomNav />
      <div data-testid="small-viewport-probe" aria-hidden="true" className="pointer-events-none invisible fixed top-0 h-svh w-px" />
    </SidebarProvider>
  );
}
