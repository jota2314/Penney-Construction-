"use client";

import { useMemo, type CSSProperties } from "react";
import { TodaysWorkCard } from "@/components/field-feed/todays-work-card";
import { DailyLogPost } from "@/components/field-feed/daily-log-post";
import { HoursStrip } from "@/components/field-feed/hours-strip";
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
    </div>
  );
}
