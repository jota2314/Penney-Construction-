"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HardHat, Clock, FolderOpen, User, Sparkles, Warehouse, MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import { useKeyboardOpen } from "@/hooks/use-keyboard-inset";

// Mounted on every crew page — keep the chat panel out of the critical bundle.
const AIChatPanel = dynamic(
  () => import("@/components/command-center/ai-chat-panel").then((m) => m.AIChatPanel),
  { ssr: false }
);

/** What a carpenter sees: the job they're on, their hours, the job folder. */
const CREW_TABS = [
  { title: "Projects", url: "/crew", icon: HardHat, exact: true },
  { title: "Time Log", url: "/crew/time-log", icon: Clock, exact: false },
  { title: "Job Folder", url: "/crew/folder", icon: FolderOpen, exact: false },
  { title: "Profile", url: "/crew/profile", icon: User, exact: false },
];

/**
 * What the warehouse runner sees. His day is a route, not a jobsite, so the
 * map leads and the warehouse replaces the request form — he fulfils orders
 * rather than raising them. /warehouse isn't an OFFICE_PREFIX and the
 * warehouse actions gate on auth rather than role, so `field` reaches it fine.
 */
const RUNNER_TABS = [
  { title: "Route", url: "/crew/map", icon: MapPinned, exact: false },
  { title: "Warehouse", url: "/warehouse", icon: Warehouse, exact: false },
  { title: "Time Log", url: "/crew/time-log", icon: Clock, exact: false },
  { title: "Profile", url: "/crew/profile", icon: User, exact: false },
];

export function CrewBottomNav({ isRunner = false }: { isRunner?: boolean }) {
  const TABS = isRunner ? RUNNER_TABS : CREW_TABS;
  const pathname = usePathname();
  const [chatOpen, setChatOpen] = useState(false);
  // iOS drags fixed-bottom chrome up with the keyboard — hide while typing.
  const keyboardOpen = useKeyboardOpen();

  const isActive = (url: string, exact: boolean) => {
    if (exact) return pathname === url;
    return pathname.startsWith(url);
  };

  return (
    <>
      <nav
        className={cn(
          "relative shrink-0 z-30 bg-background border-t border-border/50 pb-[env(safe-area-inset-bottom,8px)]",
          keyboardOpen && "hidden"
        )}
      >
        {/* FAB — absolutely centered on the nav bar, overlapping the top edge */}
        <button
          onClick={() => setChatOpen(true)}
          className="absolute left-1/2 -translate-x-1/2 -top-2 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-amber-700 text-white shadow-lg shadow-amber-600/40 active:scale-90 transition-transform z-10"
          aria-label="Open AI Assistant"
        >
          <Sparkles className="h-6 w-6" />
        </button>

        {/* 5 columns: two tabs, an empty center slot under the FAB, two tabs */}
        <div className="grid grid-cols-5 items-center px-2 h-16">
          {TABS.map((tab, i) => {
            const active = isActive(tab.url, tab.exact);
            return (
              <Link
                key={tab.url}
                href={tab.url}
                className={cn(
                  "flex flex-col items-center gap-1 py-0.5",
                  // Leave the middle column free for the FAB
                  i === 2 && "col-start-4"
                )}
              >
                <tab.icon
                  className={cn(
                    "h-6 w-6 transition-colors",
                    active ? "text-amber-500" : "text-muted-foreground/50"
                  )}
                />
                <span
                  className={cn(
                    "text-[11px] transition-colors",
                    active
                      ? "text-amber-500 font-semibold"
                      : "text-muted-foreground/50"
                  )}
                >
                  {tab.title}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      <AIChatPanel open={chatOpen} onOpenChange={setChatOpen} />
    </>
  );
}
