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

const LEFT_TABS = [
  { title: "Home", url: "/command-center", icon: Radar },
  { title: "Projects", url: "/projects", icon: FolderKanban },
];

const RIGHT_TABS = [
  { title: "Email", url: "/command-center/emails", icon: Mail },
  { title: "Todos", url: "/command-center/todos", icon: Bell },
];

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

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 md:hidden">
        <div className="relative">
          {/* Notch cutout behind FAB */}
          <div className="absolute left-1/2 -translate-x-1/2 -top-5 w-[76px] h-[40px] bg-background rounded-t-full" />

          {/* Bar background */}
          <div className="bg-background border-t border-border/40">
            <div className="flex items-center justify-around px-1 pt-1.5 pb-[env(safe-area-inset-bottom,6px)]">
              {/* Left tabs */}
              {LEFT_TABS.map((tab) => (
                <NavTab key={tab.url} tab={tab} active={isActive(tab.url)} />
              ))}

              {/* Center FAB spacer + button */}
              <div className="relative flex flex-col items-center w-16">
                <button
                  onClick={() => setChatOpen(true)}
                  className="absolute -top-9 flex h-[56px] w-[56px] items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-amber-700 text-white shadow-lg shadow-amber-600/40 active:scale-90 transition-transform"
                >
                  <Sparkles className="h-6 w-6" />
                </button>
                <span className="text-[10px] text-muted-foreground/60 mt-5">AI</span>
              </div>

              {/* Right tabs */}
              {RIGHT_TABS.map((tab) => (
                <NavTab key={tab.url} tab={tab} active={isActive(tab.url)} />
              ))}

              {/* More */}
              <button
                onClick={() => setMoreOpen(!moreOpen)}
                className="flex flex-col items-center gap-0.5 py-1 px-2 min-w-[48px]"
              >
                <MoreHorizontal className={cn(
                  "h-5 w-5 transition-colors",
                  moreOpen ? "text-amber-500" : "text-muted-foreground/60"
                )} />
                <span className={cn(
                  "text-[10px] transition-colors",
                  moreOpen ? "text-amber-500" : "text-muted-foreground/60"
                )}>
                  More
                </span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* AI Chat Panel */}
      <AIChatPanel open={chatOpen} onOpenChange={setChatOpen} />
    </>
  );
}

function NavTab({
  tab,
  active,
}: {
  tab: { title: string; url: string; icon: React.ElementType };
  active: boolean;
}) {
  return (
    <Link
      href={tab.url}
      className="flex flex-col items-center gap-0.5 py-1 px-2 min-w-[48px]"
    >
      <tab.icon
        className={cn(
          "h-5 w-5 transition-colors",
          active ? "text-amber-500" : "text-muted-foreground/60"
        )}
      />
      <span
        className={cn(
          "text-[10px] transition-colors",
          active ? "text-amber-500 font-semibold" : "text-muted-foreground/60"
        )}
      >
        {tab.title}
      </span>
    </Link>
  );
}
