"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Radar,
  FolderKanban,
  Mail,
  Bot,
  Bell,
  Menu,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { AIChatPanel } from "@/components/command-center/ai-chat-panel";
import { NAV_GROUPS } from "@/lib/constants/nav-items";

const BOTTOM_TABS = [
  { title: "Home", url: "/command-center", icon: Radar },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  // Center slot is the FAB
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
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-20 left-4 right-4 bg-card border rounded-2xl p-3 shadow-xl max-h-[60vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {NAV_GROUPS.map((group, gi) => (
              <div key={gi}>
                {group.label && (
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold px-3 pt-3 pb-1">
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
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="text-sm font-medium">{item.title}</span>
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
        {/* Background with blur */}
        <div className="absolute inset-0 bg-background/90 backdrop-blur-xl border-t" />

        <div className="relative flex items-end justify-around px-2 pb-[env(safe-area-inset-bottom,8px)]">
          {/* Left 2 tabs */}
          {BOTTOM_TABS.slice(0, 2).map((tab) => (
            <NavTab key={tab.url} tab={tab} active={isActive(tab.url)} />
          ))}

          {/* Center FAB — AI Assistant */}
          <div className="flex flex-col items-center -mt-4">
            <button
              onClick={() => setChatOpen(true)}
              className="relative flex h-14 w-14 items-center justify-center rounded-full bg-amber-600 text-white shadow-lg shadow-amber-600/30 active:scale-95 transition-transform"
            >
              <Bot className="h-7 w-7" />
            </button>
            <span className="text-[10px] text-muted-foreground mt-1">AI</span>
          </div>

          {/* Right 2 tabs */}
          {BOTTOM_TABS.slice(2).map((tab) => (
            <NavTab key={tab.url} tab={tab} active={isActive(tab.url)} />
          ))}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex flex-col items-center gap-0.5 pt-2 pb-1 px-3 min-w-[56px]"
          >
            <Menu className={cn(
              "h-6 w-6 transition-colors",
              moreOpen ? "text-amber-500" : "text-muted-foreground"
            )} />
            <span className={cn(
              "text-[10px] transition-colors",
              moreOpen ? "text-amber-500" : "text-muted-foreground"
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
  tab,
  active,
}: {
  tab: { title: string; url: string; icon: React.ElementType };
  active: boolean;
}) {
  return (
    <Link
      href={tab.url}
      className="flex flex-col items-center gap-0.5 pt-2 pb-1 px-3 min-w-[56px]"
    >
      <tab.icon
        className={cn(
          "h-6 w-6 transition-colors",
          active ? "text-amber-500" : "text-muted-foreground"
        )}
      />
      <span
        className={cn(
          "text-[10px] transition-colors",
          active ? "text-amber-500 font-medium" : "text-muted-foreground"
        )}
      >
        {tab.title}
      </span>
    </Link>
  );
}
