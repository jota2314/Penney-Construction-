"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Mountain,
  LineChart,
  Wrench,
  ListChecks,
  CalendarClock,
  Network,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/eos", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/eos/meetings", label: "Level 10", icon: CalendarClock },
  { href: "/eos/rocks", label: "Rocks", icon: Mountain },
  { href: "/eos/scorecard", label: "Scorecard", icon: LineChart },
  { href: "/eos/issues", label: "Issues", icon: Wrench },
  { href: "/eos/todos", label: "To-Dos", icon: ListChecks },
  { href: "/eos/accountability", label: "Accountability", icon: Network },
  { href: "/eos/vto", label: "V/TO", icon: Target },
];

export function EosTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="EOS sections"
      className="flex gap-1 overflow-x-auto border-b px-4 pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-amber-500 text-amber-500"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
