"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { v } from "./tokens";
import { ShiftWrapUp } from "./shift-wrap-up";
import { MAX_SHIFT_HOURS, MAX_SHIFT_MS } from "@/lib/crew/shift";
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

const MAX_SHIFT_SEC = Math.floor(MAX_SHIFT_MS / 1000);

export function HoursStrip({ summary }: { summary: HoursSummary }) {
  const { todayMinutes, weekMinutes, openLog } = summary;
  const router = useRouter();
  const [wrapUp, setWrapUp] = useState(false);
  const capped = !!openLog?.cappedAtMaxHours;

  // Live elapsed seconds since clock-in (ticks every second when active).
  // Once the shift passes the 12h max, freeze at the cap — the hourly cron
  // closes it for real and we don't want a runaway ticker in the meantime.
  const [elapsedSec, setElapsedSec] = useState<number>(() => {
    if (!openLog) return 0;
    const raw = Math.max(0, Math.floor((Date.now() - new Date(openLog.startedAt).getTime()) / 1000));
    return capped ? Math.min(raw, MAX_SHIFT_SEC) : raw;
  });

  useEffect(() => {
    // Capped shifts are frozen at the max by the state initializer — no ticker.
    if (!openLog || capped) return;
    const tick = () => {
      const raw = Math.max(0, Math.floor((Date.now() - new Date(openLog.startedAt).getTime()) / 1000));
      setElapsedSec(Math.min(raw, MAX_SHIFT_SEC));
    };
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [openLog, capped]);

  const liveMinutes = openLog ? Math.floor(elapsedSec / 60) : 0;
  const todayDisplay = todayMinutes + liveMinutes;

  const handleClockOut = () => setWrapUp(true);

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
        <>
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

          {capped && (
            <div
              className="rounded-lg px-3 py-2 text-[12px] leading-snug"
              style={{ background: "rgba(217, 119, 6, 0.10)", color: "#fbbf24", border: "1px solid rgba(217, 119, 6, 0.30)" }}
            >
              This shift passed {MAX_SHIFT_HOURS}h — looks like a missed clock-out. It&apos;ll be
              capped at {MAX_SHIFT_HOURS}h automatically. Clock out now to fix it.
            </div>
          )}

          <button
            onClick={handleClockOut}
            className="w-full py-3 rounded-xl flex items-center justify-center gap-2 text-[14px] font-semibold transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: "#dc2626", color: "#fff" }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 6v4l2.5 2" />
            </svg>
            Clock out
          </button>

          {wrapUp && <ShiftWrapUp logId={openLog.id} onClose={() => setWrapUp(false)} onSaved={() => router.refresh()} />}
        </>
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
