"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { TodaysWorkCard } from "@/components/field-feed/todays-work-card";
import { DailyLogPost } from "@/components/field-feed/daily-log-post";
import { HoursStrip } from "@/components/field-feed/hours-strip";
import { JobClockInSheet } from "@/components/field-feed/job-clock-in-sheet";
import { PCC_TOKENS, v } from "@/components/field-feed/tokens";
import type { TodayPhase, FeedDailyLog, HoursSummary } from "@/lib/actions/daily-logs";

export function CrewFlow({
  firstName,
  phases,
  logs,
  hours,
}: {
  firstName: string | null;
  phases: TodayPhase[];
  logs: FeedDailyLog[];
  hours: HoursSummary;
}) {
  const [clockInOpen, setClockInOpen] = useState(false);

  const greeting = useMemo(() => {
    const hr = new Date().getHours();
    return hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : "Evening";
  }, []);
  const today = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [],
  );

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

        {/* My hours — today, this week, live ticker if clocked in */}
        <HoursStrip summary={hours} />

        {/* Clock in to any job — BuilderTrend-style job search. Hidden while
            already on the clock (the Hours strip shows Clock out instead). */}
        {!hours.openLog && (
          <button
            onClick={() => setClockInOpen(true)}
            className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 text-[15px] font-semibold transition active:scale-[0.98]"
            style={{ background: v("accent"), color: "#1a0f00" }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 6v4l2.5 2" />
            </svg>
            Clock in to a job
          </button>
        )}

        {/* Today's work — phases assigned to me, today */}
        <TodaysWorkCard phases={phases} />

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
    </div>
  );
}
