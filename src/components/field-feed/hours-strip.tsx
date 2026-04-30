"use client";

import { useEffect, useState } from "react";
import { v } from "./tokens";
import type { HoursSummary } from "@/lib/actions/daily-logs";

function fmtHours(totalMinutes: number): string {
  if (totalMinutes <= 0) return "0h";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function HoursStrip({ summary }: { summary: HoursSummary }) {
  const { todayMinutes, weekMinutes, openLog } = summary;

  // Live elapsed seconds since clock-in (ticks every second when active).
  const [elapsedSec, setElapsedSec] = useState<number>(() => {
    if (!openLog) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(openLog.startedAt).getTime()) / 1000));
  });

  useEffect(() => {
    if (!openLog) return;
    const tick = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - new Date(openLog.startedAt).getTime()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [openLog]);

  const liveMinutes = openLog ? Math.floor(elapsedSec / 60) : 0;
  const todayDisplay = todayMinutes + liveMinutes;

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{
        background: openLog
          ? "linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(16, 185, 129, 0.02))"
          : v("card"),
        border: openLog ? "1px solid rgba(16, 185, 129, 0.30)" : `1px solid ${v("line")}`,
      }}
    >
      {openLog && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div
              className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase"
              style={{ color: "#34d399", letterSpacing: "0.16em" }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }}
              />
              On the clock
            </div>
            <div className="text-[13px] truncate mt-0.5" style={{ color: v("ink") }}>
              {openLog.project_name ?? "Project"}
              {openLog.phase_name ? <span className="opacity-70"> · {openLog.phase_name}</span> : null}
            </div>
          </div>
          <div
            className="text-[22px] font-semibold tabular-nums tracking-tight"
            style={{ color: "#34d399", fontVariantNumeric: "tabular-nums" }}
          >
            {fmtTimer(elapsedSec)}
          </div>
        </div>
      )}

      <div
        className="grid grid-cols-2 gap-2"
        style={openLog ? { borderTop: `1px solid rgba(16, 185, 129, 0.20)`, paddingTop: 12 } : undefined}
      >
        <div className="flex flex-col">
          <span className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: v("quiet") }}>
            Today
          </span>
          <span
            className="text-[20px] font-semibold tabular-nums tracking-tight mt-0.5"
            style={{ color: v("ink"), fontVariantNumeric: "tabular-nums" }}
          >
            {fmtHours(todayDisplay)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: v("quiet") }}>
            This week
          </span>
          <span
            className="text-[20px] font-semibold tabular-nums tracking-tight mt-0.5"
            style={{ color: v("ink"), fontVariantNumeric: "tabular-nums" }}
          >
            {fmtHours(weekMinutes + liveMinutes)}
          </span>
        </div>
      </div>
    </div>
  );
}
