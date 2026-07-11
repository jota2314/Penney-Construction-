"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HardHat, Clock, Package, User, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIChatPanel } from "@/components/command-center/ai-chat-panel";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";

const TABS = [
  { title: "Projects", url: "/crew", icon: HardHat, exact: true },
  { title: "Time Log", url: "/crew/time-log", icon: Clock, exact: false },
  { title: "Materials", url: "/crew/materials", icon: Package, exact: false },
  { title: "Profile", url: "/crew/profile", icon: User, exact: false },
];

export function CrewBottomNav() {
  const pathname = usePathname();
  const [chatOpen, setChatOpen] = useState(false);
  // iOS drags fixed-bottom chrome up with the keyboard — hide while typing.
  const keyboardOpen = useKeyboardInset().inset > 0;

  const isActive = (url: string, exact: boolean) => {
    if (exact) return pathname === url;
    return pathname.startsWith(url);
  };

  return (
    <>
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-30 bg-background border-t border-border/50 pb-[env(safe-area-inset-bottom,8px)]",
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
