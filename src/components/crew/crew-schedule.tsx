"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TodayPhase } from "@/lib/actions/daily-logs";
import { scheduleDays, scheduleDateLabel, workOnDate } from "@/lib/crew/schedule-dates";
import { TodaysWorkCard } from "@/components/field-feed/todays-work-card";
import { v } from "@/components/field-feed/tokens";

export function CrewSchedule({ phases, today, unavailable = false }: {
  phases: TodayPhase[]; today: string; unavailable?: boolean;
}) {
  const [selected, setSelected] = useState(today);
  const strip = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);
  const days = scheduleDays(today);
  const date = days.includes(selected) ? selected : today;
  const isToday = date === today;
  const label = scheduleDateLabel(date, { weekday: "long", month: "short", day: "numeric" });

  return (
    <section aria-label="My schedule" className="min-w-0 flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-[18px] font-semibold">My schedule</h2>
          <p className="text-[12px]" style={{ color: v("muted") }}>Next 14 days · swipe to look ahead</p>
        </div>
        <button type="button" className="min-h-11 px-3 text-[13px] rounded-xl" style={{ color: v("accent"), border: `1px solid ${v("line")}` }}
          onClick={() => { setSelected(today); strip.current?.scrollTo({ left: 0, behavior: "smooth" }); }}>
          Today
        </button>
      </div>
      <div ref={strip} role="group" aria-label="Choose a work date" className="flex gap-2 overflow-x-auto pb-2 snap-x" style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "thin", scrollbarColor: "#66503a transparent" }}>
        {days.map((day) => {
          const count = workOnDate(phases, day).length;
          const active = day === date;
          const fullDate = scheduleDateLabel(day, { weekday: "long", month: "long", day: "numeric" });
          return (
            <button key={day} type="button" aria-pressed={active} aria-label={`${fullDate}${unavailable ? ", schedule unavailable" : `, ${count} assignments`}`}
              onClick={() => setSelected(day)}
              className="shrink-0 snap-start w-[72px] rounded-xl py-2.5 flex flex-col items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ background: active ? v("accent") : v("card"), color: active ? "#1a0f00" : v("ink"), border: `1px solid ${active ? v("accent") : v("line")}` }}>
              <span className="text-[12px] font-medium">{day === today ? "Today" : scheduleDateLabel(day, { weekday: "short" })}</span>
              <span className="text-[16px] font-semibold">{scheduleDateLabel(day, { month: "short", day: "numeric" })}</span>
              <span className="text-[10px]">{unavailable ? "—" : count ? `${count} ${count === 1 ? "task" : "tasks"}` : "—"}</span>
            </button>
          );
        })}
      </div>
      <div aria-live="polite" aria-atomic="true" className="text-[13px] px-1" style={{ color: v("muted") }}>{label}</div>
      {unavailable ? (
        <div className="rounded-2xl p-5 text-[14px]" role="alert" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
          <p>Your schedule couldn’t load. Try again to see your assignments.</p>
          <button type="button" disabled={refreshing} onClick={() => refresh(() => router.refresh())} className="min-h-11 mt-2 font-semibold" style={{ color: v("accent") }}>{refreshing ? "Refreshing…" : "Try again"}</button>
        </div>
      ) : <TodaysWorkCard key={date} phases={workOnDate(phases, date)} selectedDate={date} isToday={isToday} />}
    </section>
  );
}
