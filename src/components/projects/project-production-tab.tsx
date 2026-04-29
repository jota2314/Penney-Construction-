"use client";

import { HardHat } from "lucide-react";
import { DailyLogPost } from "@/components/field-feed/daily-log-post";
import { PCC_TOKENS } from "@/components/field-feed/tokens";
import type { FeedDailyLog } from "@/lib/actions/daily-logs";

interface ProjectProductionTabProps {
  dailyLogs: FeedDailyLog[];
}

export function ProjectProductionTab({ dailyLogs }: ProjectProductionTabProps) {
  if (dailyLogs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 flex flex-col items-center text-center">
        <HardHat className="h-8 w-8 text-orange-500 mb-3 opacity-70" />
        <h3 className="text-sm font-semibold mb-1">No daily logs yet</h3>
        <p className="text-xs text-muted-foreground max-w-sm">
          When the crew clocks in/out on a phase scheduled for this project, their daily logs (text + photos) will land here.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{ ...PCC_TOKENS, background: "var(--pcc-bg)", color: "var(--pcc-ink)" }}
    >
      <div className="flex items-baseline justify-between mb-3 px-1">
        <div
          className="text-[11px] font-medium uppercase"
          style={{ color: "var(--pcc-quiet)", letterSpacing: "0.18em" }}
        >
          From the field
        </div>
        <div className="text-[12px]" style={{ color: "var(--pcc-muted)" }}>
          {dailyLogs.length} {dailyLogs.length === 1 ? "log" : "logs"}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {dailyLogs.map((log) => (
          <DailyLogPost key={log.id} log={log} />
        ))}
      </div>
    </div>
  );
}
