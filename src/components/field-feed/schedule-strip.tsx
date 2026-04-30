"use client";

import { useMemo, useState } from "react";
import { v } from "./tokens";
import type { WeekSchedulePhase } from "@/lib/actions/daily-logs";

function colorFromId(id: string): string {
  const palette = ["#D97706", "#0E7490", "#7C3AED", "#DC2626", "#059669", "#0891B2", "#B45309", "#0F766E"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function initials(first: string, last: string): string {
  return ((first?.[0] || "?") + (last?.[0] || "")).toUpperCase();
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildWeekDays(weekStartIso: string): Date[] {
  const start = new Date(weekStartIso + "T00:00:00");
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function phasesOnDate(phases: WeekSchedulePhase[], date: Date): WeekSchedulePhase[] {
  const k = dateKey(date);
  return phases.filter((p) => p.start_date <= k && p.end_date >= k);
}

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ScheduleStrip({
  weekStart,
  phases,
}: {
  weekStart: string;
  weekEnd: string;
  phases: WeekSchedulePhase[];
}) {
  const days = useMemo(() => buildWeekDays(weekStart), [weekStart]);
  const todayKey = dateKey(new Date());
  const [view, setView] = useState<"week" | "day">("day");
  const [selectedDayKey, setSelectedDayKey] = useState<string>(
    days.find((d) => dateKey(d) === todayKey) ? todayKey : dateKey(days[0]),
  );

  const selectedDate = useMemo(() => {
    const found = days.find((d) => dateKey(d) === selectedDayKey);
    return found ?? days[0];
  }, [days, selectedDayKey]);

  const dayPhases = useMemo(() => phasesOnDate(phases, selectedDate), [phases, selectedDate]);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: v("card"), border: `1px solid ${v("line")}` }}
    >
      {/* Header */}
      <div className="px-4 pt-3.5 pb-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${v("line-soft")}` }}>
        <div>
          <div className="text-[10px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
            Schedule
          </div>
          <div className="text-[16px] font-semibold leading-tight mt-0.5" style={{ color: v("ink") }}>
            {days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} —{" "}
            {days[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}>
          {(["week", "day"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className="px-3 py-1 rounded-md text-[12px] font-semibold transition"
              style={{
                background: view === mode ? v("accent") : "transparent",
                color: view === mode ? "#1a0f00" : v("muted"),
              }}
            >
              {mode === "week" ? "Week" : "Day"}
            </button>
          ))}
        </div>
      </div>

      {view === "week" ? (
        <div className="p-3">
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const k = dateKey(d);
              const isToday = k === todayKey;
              const items = phasesOnDate(phases, d);
              return (
                <button
                  key={k}
                  onClick={() => {
                    setSelectedDayKey(k);
                    setView("day");
                  }}
                  className="rounded-lg p-2 flex flex-col gap-1.5 text-left transition active:scale-[0.98]"
                  style={{
                    background: isToday ? "rgba(217, 119, 6, 0.10)" : v("bg-2"),
                    border: `1px solid ${isToday ? "rgba(217, 119, 6, 0.45)" : v("line")}`,
                    minHeight: 96,
                  }}
                >
                  <div className="flex items-baseline justify-between">
                    <span
                      className="text-[10px] font-medium uppercase"
                      style={{ color: isToday ? v("accent") : v("quiet"), letterSpacing: "0.14em" }}
                    >
                      {DOW_SHORT[(d.getDay() + 6) % 7]}
                    </span>
                    <span
                      className="text-[14px] font-semibold tabular-nums"
                      style={{ color: isToday ? v("accent") : v("ink") }}
                    >
                      {d.getDate()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 min-h-0 flex-1">
                    {items.slice(0, 3).map((p) => (
                      <div
                        key={p.id}
                        className="rounded text-[10px] leading-tight px-1.5 py-1 truncate"
                        style={{ background: `${p.color}22`, borderLeft: `2px solid ${p.color}`, color: v("ink") }}
                      >
                        <div className="font-semibold truncate">{p.project_name}</div>
                        <div className="opacity-70 truncate">{p.name}</div>
                      </div>
                    ))}
                    {items.length > 3 && (
                      <div className="text-[10px]" style={{ color: v("quiet") }}>
                        +{items.length - 3} more
                      </div>
                    )}
                    {items.length === 0 && (
                      <div className="text-[10px] italic" style={{ color: v("quiet") }}>
                        —
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="p-3 flex flex-col gap-3">
          {/* Day picker chips */}
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {days.map((d) => {
              const k = dateKey(d);
              const isSelected = k === selectedDayKey;
              const isToday = k === todayKey;
              const count = phasesOnDate(phases, d).length;
              return (
                <button
                  key={k}
                  onClick={() => setSelectedDayKey(k)}
                  className="flex flex-col items-center px-3 py-1.5 rounded-lg flex-shrink-0 transition"
                  style={{
                    background: isSelected ? v("accent") : v("bg-2"),
                    border: `1px solid ${isSelected ? "transparent" : isToday ? "rgba(217, 119, 6, 0.35)" : v("line")}`,
                    color: isSelected ? "#1a0f00" : isToday ? v("accent") : v("ink"),
                    minWidth: 56,
                  }}
                >
                  <span className="text-[10px] font-medium uppercase" style={{ letterSpacing: "0.14em" }}>
                    {DOW_SHORT[(d.getDay() + 6) % 7]}
                  </span>
                  <span className="text-[16px] font-semibold tabular-nums leading-none mt-0.5">
                    {d.getDate()}
                  </span>
                  {count > 0 && (
                    <span className="text-[9px] mt-1 opacity-70">
                      {count} {count === 1 ? "job" : "jobs"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Day agenda */}
          <div className="flex flex-col gap-2">
            {dayPhases.length === 0 ? (
              <div
                className="rounded-lg px-4 py-8 text-center"
                style={{ background: v("bg-2"), border: `1px dashed ${v("line")}`, color: v("muted") }}
              >
                <div className="text-[13px]">Nothing scheduled</div>
                <div className="text-[11px] opacity-70 mt-1">
                  {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </div>
              </div>
            ) : (
              dayPhases.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl p-3 flex flex-col gap-2"
                  style={{
                    background: v("bg-2"),
                    border: `1px solid ${v("line")}`,
                    borderLeft: `3px solid ${p.color}`,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[10px] font-mono uppercase" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>
                      {p.project_number}
                    </div>
                    {p.start_date !== p.end_date && (
                      <div className="text-[10px] uppercase" style={{ color: v("quiet"), letterSpacing: "0.14em" }}>
                        {new Date(p.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {" → "}
                        {new Date(p.end_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold leading-tight" style={{ color: v("ink") }}>
                      {p.project_name}
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ color: v("muted") }}>
                      {p.name}
                      {p.line_item_description && <span className="opacity-70"> · {p.line_item_description}</span>}
                    </div>
                  </div>
                  {(p.project_address || p.project_city) && (
                    <div className="text-[11px]" style={{ color: v("muted") }}>
                      {[p.project_address, p.project_city].filter(Boolean).join(", ")}
                    </div>
                  )}
                  {p.crew.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[9px] uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>Crew</span>
                      {p.crew.map((c) => (
                        <span
                          key={c.id}
                          title={`${c.first_name} ${c.last_name}`}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
                          style={{ background: `${colorFromId(c.id)}22`, border: `1px solid ${colorFromId(c.id)}55`, color: colorFromId(c.id) }}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                            style={{ background: colorFromId(c.id) }}
                          >
                            {initials(c.first_name, c.last_name)}
                          </span>
                          {c.first_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
