"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HardHat, Clock, User, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIChatPanel } from "@/components/command-center/ai-chat-panel";

const TABS = [
  { title: "Projects", url: "/crew", icon: HardHat, exact: true },
  { title: "Time Log", url: "/crew/time-log", icon: Clock, exact: false },
  { title: "Profile", url: "/crew/profile", icon: User, exact: false },
];

export function CrewBottomNav() {
  const pathname = usePathname();
  const [chatOpen, setChatOpen] = useState(false);

  const isActive = (url: string, exact: boolean) => {
    if (exact) return pathname === url;
    return pathname.startsWith(url);
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-background border-t border-border/50 pb-[env(safe-area-inset-bottom,8px)]">
        <div className="grid grid-cols-4 items-center px-4 h-16">
          {/* Projects */}
          <Link
            href={TABS[0].url}
            className="flex flex-col items-center gap-1 py-0.5"
          >
            <HardHat
              className={cn(
                "h-6 w-6 transition-colors",
                isActive(TABS[0].url, TABS[0].exact)
                  ? "text-amber-500"
                  : "text-muted-foreground/50"
              )}
            />
            <span
              className={cn(
                "text-[11px] transition-colors",
                isActive(TABS[0].url, TABS[0].exact)
                  ? "text-amber-500 font-semibold"
                  : "text-muted-foreground/50"
              )}
            >
              {TABS[0].title}
            </span>
          </Link>

          {/* Time Log */}
          <Link
            href={TABS[1].url}
            className="flex flex-col items-center gap-1 py-0.5"
          >
            <Clock
              className={cn(
                "h-6 w-6 transition-colors",
                isActive(TABS[1].url, TABS[1].exact)
                  ? "text-amber-500"
                  : "text-muted-foreground/50"
              )}
            />
            <span
              className={cn(
                "text-[11px] transition-colors",
                isActive(TABS[1].url, TABS[1].exact)
                  ? "text-amber-500 font-semibold"
                  : "text-muted-foreground/50"
              )}
            >
              {TABS[1].title}
            </span>
          </Link>

          {/* AI Chat FAB */}
          <div className="flex items-center justify-center">
            <button
              onClick={() => setChatOpen(true)}
              className="flex h-14 w-14 -mt-5 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-amber-700 text-white shadow-lg shadow-amber-600/40 active:scale-90 transition-transform"
              aria-label="Open AI Assistant"
            >
              <Sparkles className="h-6 w-6" />
            </button>
          </div>

          {/* Profile */}
          <Link
            href={TABS[2].url}
            className="flex flex-col items-center gap-1 py-0.5"
          >
            <User
              className={cn(
                "h-6 w-6 transition-colors",
                isActive(TABS[2].url, TABS[2].exact)
                  ? "text-amber-500"
                  : "text-muted-foreground/50"
              )}
            />
            <span
              className={cn(
                "text-[11px] transition-colors",
                isActive(TABS[2].url, TABS[2].exact)
                  ? "text-amber-500 font-semibold"
                  : "text-muted-foreground/50"
              )}
            >
              {TABS[2].title}
            </span>
          </Link>
        </div>
      </nav>

      <AIChatPanel open={chatOpen} onOpenChange={setChatOpen} />
    </>
  );
}
