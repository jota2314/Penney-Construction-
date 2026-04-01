"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HardHat, Clock, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { title: "Projects", url: "/crew", icon: HardHat, exact: true },
  { title: "Time Log", url: "/crew/time-log", icon: Clock, exact: false },
  { title: "Profile", url: "/crew/profile", icon: User, exact: false },
];

export function CrewBottomNav() {
  const pathname = usePathname();

  const isActive = (url: string, exact: boolean) => {
    if (exact) return pathname === url;
    return pathname.startsWith(url);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-background border-t border-border/50 pb-[env(safe-area-inset-bottom,8px)]">
      <div className="grid grid-cols-3 items-center px-6 h-16">
        {TABS.map((tab) => {
          const active = isActive(tab.url, tab.exact);
          return (
            <Link
              key={tab.url}
              href={tab.url}
              className="flex flex-col items-center gap-1 py-0.5"
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
  );
}
