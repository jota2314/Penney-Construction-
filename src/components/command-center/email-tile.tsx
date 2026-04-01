"use client";

import { useState } from "react";
import { Mail, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { NavigationTile } from "./navigation-tile";
import { MiniSparkline } from "./mini-charts";
import type { HubMetrics } from "@/lib/actions/command-center-hub";

type EmailMetrics = HubMetrics["email"];
type Filter = "all" | "day" | "week" | "month";

const LABELS: Record<Filter, string> = {
  all: "All Emails",
  day: "Today",
  week: "This Week",
  month: "This Month",
};

export function EmailTile({ email }: { email: EmailMetrics }) {
  // Default to "all" if no emails this week, so the tile isn't empty
  const [filter, setFilter] = useState<Filter>(email.week.total > 0 ? "week" : "all");

  const data = email[filter];

  return (
    <NavigationTile
      title="Email"
      icon={Mail}
      iconColorClass="bg-sky-500/15 text-sky-500"
      metric={data.total}
      metricLabel={LABELS[filter]}
      metricColorClass="text-sky-600 dark:text-sky-400"
      href="/command-center/emails"
    >
      <div className="space-y-2">
        {/* Filter buttons */}
        <div className="flex gap-1">
          {(["all", "day", "week", "month"] as const).map((f) => (
            <button
              key={f}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setFilter(f);
              }}
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                filter === f
                  ? "bg-sky-500 text-white"
                  : "bg-muted text-muted-foreground hover:bg-sky-500/20 hover:text-sky-500"
              }`}
            >
              {f === "all" ? "All" : f === "day" ? "D" : f === "week" ? "W" : "M"}
            </button>
          ))}
        </div>

        {/* Sent / Received breakdown */}
        <div className="flex gap-3 text-[11px]">
          <div className="flex items-center gap-1">
            <ArrowUpRight className="h-3 w-3 text-emerald-500" />
            <span className="text-muted-foreground">Sent</span>
            <span className="font-semibold text-emerald-500">{data.sent}</span>
          </div>
          <div className="flex items-center gap-1">
            <ArrowDownLeft className="h-3 w-3 text-blue-400" />
            <span className="text-muted-foreground">In</span>
            <span className="font-semibold text-blue-400">{data.received}</span>
          </div>
        </div>

        {/* Sparkline for week view */}
        {filter === "week" && <MiniSparkline data={email.dailyVolume} />}
      </div>
    </NavigationTile>
  );
}
