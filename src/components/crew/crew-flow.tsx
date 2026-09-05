"use client";

import { useState, type CSSProperties } from "react";
import { scheduleDateLabel } from "@/lib/crew/schedule-dates";
import { CrewSchedule } from "@/components/crew/crew-schedule";
import { DailyLogPost } from "@/components/field-feed/daily-log-post";
import { HoursStrip } from "@/components/field-feed/hours-strip";
import { JobClockInSheet } from "@/components/field-feed/job-clock-in-sheet";
import { ReceiptCapture } from "@/components/crew/receipt-capture";
import { PCC_TOKENS, v } from "@/components/field-feed/tokens";
import type { TodayPhase, FeedDailyLog, HoursSummary } from "@/lib/actions/daily-logs";

export function CrewFlow({
  firstName,
  greeting,
  phases,
  scheduleToday,
  scheduleUnavailable,
  logs,
  hours,
}: {
  firstName: string | null;
  greeting: string;
  phases: TodayPhase[];
  scheduleToday: string;
  scheduleUnavailable: boolean;
  logs: FeedDailyLog[];
  hours: HoursSummary;
}) {
  const [clockInOpen, setClockInOpen] = useState(false);
  const [postUpdateOpen, setPostUpdateOpen] = useState(false);

  const today = scheduleDateLabel(scheduleToday, { weekday: "long", month: "long", day: "numeric" });

  const wrapperStyle: CSSProperties = {
    ...PCC_TOKENS,
    background: v("bg"),
    color: v("ink"),
    fontFamily: "var(--font-geist-sans), -apple-system, sans-serif",
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-5 sm:py-6 pb-32" style={wrapperStyle}>
      <div className="w-full max-w-[460px] flex flex-col gap-4">
        {/* Greeting */}
        <div>
          <div className="text-[12px] font-mono uppercase" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>
            {today}
          </div>
          <div
            className="text-[28px] sm:text-[32px] font-semibold tracking-tight mt-1.5 leading-tight"
            style={{ color: v("ink") }}
          >
            {greeting}
            {firstName ? (
              <>
                ,{" "}
                <span style={{ color: v("accent") }}>{firstName}</span>.
              </>
            ) : (
              "."
            )}
          </div>
        </div>

        {/* Hours strip — only while on the clock (it carries the live timer +
            Clock Out). Off the clock, hours live in the Time Log tab. */}
        {hours.openLog && <HoursStrip summary={hours} />}

        {/* Post update — the fastest path: pick a job, add photos + a note,
            done. No schedule, no clock-in needed. */}
        <button
          onClick={() => setPostUpdateOpen(true)}
          className="w-full flex items-center gap-3 rounded-2xl px-3.5 py-3.5 text-left transition active:scale-[0.99]"
          style={{ background: v("accent"), border: "1px solid rgba(217,119,6,0.5)" }}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(0,0,0,0.18)" }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-[18px] h-[18px]" style={{ color: "#1a0f00" }}>
              <path d="M4 6h3l1.5-2h3L13 6h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
              <circle cx="10" cy="11" r="2.5" />
            </svg>
          </span>
          <span className="flex flex-col min-w-0 flex-1">
            <span className="text-[15px] font-semibold" style={{ color: "#1a0f00" }}>Post update</span>
            <span className="text-[11px] truncate" style={{ color: "rgba(26,15,0,0.72)" }}>Photos + notes from the job — takes 30 seconds</span>
          </span>
        </button>

        {/* Search any job — find plans, directions, and clock in. Always
            available, even mid-shift (browse plans without clocking in). */}
        <button
          onClick={() => setClockInOpen(true)}
          className="w-full flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition active:scale-[0.99]"
          style={{
            background: "linear-gradient(180deg, rgba(217,119,6,0.07), rgba(0,0,0,0))",
            border: "1px solid rgba(217,119,6,0.28)",
          }}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(217,119,6,0.16)" }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-[18px] h-[18px]" style={{ color: v("accent") }}>
              <circle cx="9" cy="9" r="6" />
              <path d="M14 14l3 3" strokeLinecap="round" />
            </svg>
          </span>
          <span className="flex flex-col min-w-0 flex-1">
            <span className="text-[14px] font-medium" style={{ color: v("ink") }}>Find a job</span>
            <span className="text-[11px] truncate" style={{ color: v("quiet") }}>Search jobs · plans · directions · clock in</span>
          </span>
        </button>

        {/* Scan a receipt — materials bought at the counter file themselves
            against the job's budget, so cost lands the day it's spent. */}
        <ReceiptCapture />

        {/* My assignments, today and the next two weeks. */}
        <CrewSchedule key={scheduleToday} phases={phases} today={scheduleToday} unavailable={scheduleUnavailable} />

        {/* Social feed — everyone's recent daily logs */}
        {logs.length > 0 && (
          <>
            <div className="flex items-center gap-3 pt-2 px-1">
              <div
                className="text-[11px] font-medium uppercase"
                style={{ color: v("quiet"), letterSpacing: "0.18em" }}
              >
                From the field
              </div>
              <div className="flex-1 h-px" style={{ background: v("line") }} />
            </div>
            <div className="flex flex-col gap-3">
              {logs.map((log) => (
                <DailyLogPost key={log.id} log={log} />
              ))}
            </div>
          </>
        )}
      </div>

      {clockInOpen && <JobClockInSheet onClose={() => setClockInOpen(false)} />}
      {postUpdateOpen && <JobClockInSheet intent="update" onClose={() => setPostUpdateOpen(false)} />}
    </div>
  );
}
