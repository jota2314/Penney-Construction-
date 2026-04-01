"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Radar,
  FolderKanban,
  Mail,
  Sparkles,
  Bell,
  MoreHorizontal,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { AIChatPanel } from "@/components/command-center/ai-chat-panel";
import { NAV_GROUPS } from "@/lib/constants/nav-items";

export function MobileBottomNav() {
  const pathname = usePathname();
  const [chatOpen, setChatOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (url: string) => {
    if (url === "/command-center") return pathname === "/command-center";
    return pathname.startsWith(url);
  };

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="absolute bottom-24 left-3 right-3 bg-card/95 backdrop-blur-xl border border-border/50 rounded-2xl p-2 shadow-2xl max-h-[60vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {NAV_GROUPS.map((group, gi) => (
              <div key={gi}>
                {group.label && (
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-3 pt-3 pb-1">
                    {group.label}
                  </p>
                )}
                {group.items.map((item) => {
                  const active = isActive(item.url);
                  return (
                    <Link
                      key={item.url}
                      href={item.url}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors",
                        active
                          ? "bg-amber-500/15 text-amber-500"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="text-[15px] font-medium">{item.title}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FAB — positioned above the bar, centered */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+52px)] left-1/2 -translate-x-1/2 z-40 md:hidden">
        <button
          onClick={() => setChatOpen(true)}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-amber-700 text-white shadow-lg shadow-amber-600/40 active:scale-90 transition-transform ring-[5px] ring-background"
        >
          <Sparkles className="h-7 w-7" />
        </button>
      </div>

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-background border-t border-border/40">
        <div className="grid grid-cols-5 items-end px-2 pt-4 pb-[calc(env(safe-area-inset-bottom,6px)+8px)]">
          {/* 1 - Home */}
          <NavTab title="Home" url="/command-center" icon={Radar} active={isActive("/command-center")} />

          {/* 2 - Projects */}
          <NavTab title="Projects" url="/projects" icon={FolderKanban} active={isActive("/projects")} />

          {/* 3 - Center spacer for FAB */}
          <div className="flex flex-col items-center">
            <span className="text-[11px] text-muted-foreground/50 mt-4">AI</span>
          </div>

          {/* 4 - Email */}
          <NavTab title="Email" url="/command-center/emails" icon={Mail} active={isActive("/command-center/emails")} />

          {/* 5 - More (replaces Todos as a tab — Todos accessible via More) */}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex flex-col items-center gap-1 py-0.5"
          >
            <MoreHorizontal className={cn(
              "h-6 w-6 transition-colors",
              moreOpen ? "text-amber-500" : "text-muted-foreground/50"
            )} />
            <span className={cn(
              "text-[11px] transition-colors",
              moreOpen ? "text-amber-500" : "text-muted-foreground/50"
            )}>
              More
            </span>
          </button>
        </div>
      </nav>

      {/* AI Chat Panel */}
      <AIChatPanel open={chatOpen} onOpenChange={setChatOpen} />
    </>
  );
}

function NavTab({
  title,
  url,
  icon: Icon,
  active,
}: {
  title: string;
  url: string;
  icon: React.ElementType;
  active: boolean;
}) {
  return (
    <Link href={url} className="flex flex-col items-center gap-1 py-0.5">
      <Icon
        className={cn(
          "h-6 w-6 transition-colors",
          active ? "text-amber-500" : "text-muted-foreground/50"
        )}
      />
      <span
        className={cn(
          "text-[11px] transition-colors",
          active ? "text-amber-500 font-semibold" : "text-muted-foreground/50"
        )}
      >
        {title}
      </span>
    </Link>
  );
}
