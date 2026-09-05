"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { CheckCircle, Lock, Users, ZoomIn, ZoomOut, Crosshair } from "lucide-react";
import type { CascadeResult } from "@/lib/schedule/cascade";

export interface GanttPhase {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  status: string;
  color: string;
  event_type: string | null;
  sort_order: number;
  is_confirmed?: boolean;
  assigned_employee_ids?: string[];
}

interface ScheduleGanttProps {
  phases: GanttPhase[];
  /** Live cascade — unconfirmed phases slide with the slip ahead of them. */
  cascade?: Map<string, CascadeResult>;
  selectedId?: string | null;
  onSelectPhase?: (id: string) => void;
}

const DAY = 86400000;

/** Day width in px per zoom level. */
const ZOOM_LEVELS = [
  { key: "month", label: "Months", dayWidth: 4 },
  { key: "week", label: "Weeks", dayWidth: 12 },
  { key: "day", label: "Days", dayWidth: 30 },
] as const;

const ROW_H = 34;

function parseDate(d: string): Date {
  return new Date(`${d.slice(0, 10)}T00:00:00`);
}

function toKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Whole days between two midnights — DST safe enough at this scale. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

// A milestone is a same-day event the crew shows up for, not a run of work.
const MILESTONE_TYPES = new Set(["inspection", "meeting", "walkthrough", "shop_meeting"]);

export function ScheduleGantt({
  phases,
  cascade,
  selectedId,
  onSelectPhase,
}: ScheduleGanttProps) {
  const [zoomIdx, setZoomIdx] = useState(1); // weeks
  const zoom = ZOOM_LEVELS[zoomIdx];
  const dayWidth = zoom.dayWidth;
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Every phase resolved to the dates it actually lands on, in schedule order.
  const rows = useMemo(() => {
    return [...phases]
      .map((p) => {
        const c = cascade?.get(p.id);
        const useCascade =
          c && !c.firm && c.start_date && c.end_date && c.start_date !== p.start_date;
        const startStr = useCascade ? c!.start_date! : p.start_date;
        const endStr = useCascade ? c!.end_date! : p.end_date;
        const start = parseDate(startStr);
        let end = parseDate(endStr);
        if (end < start) end = start;
        return {
          phase: p,
          start,
          end,
          shifted: Boolean(useCascade),
          slipDays: c?.slip_days ?? 0,
          baselineStart: p.planned_start_date ? parseDate(p.planned_start_date) : null,
          baselineEnd: p.planned_end_date ? parseDate(p.planned_end_date) : null,
        };
      })
      .sort(
        (a, b) =>
          a.start.getTime() - b.start.getTime() ||
          a.phase.sort_order - b.phase.sort_order
      );
  }, [phases, cascade]);

  // Chart window: the whole job plus its baselines, padded to clean weeks.
  const { rangeStart, totalDays } = useMemo(() => {
    if (rows.length === 0) {
      return { rangeStart: today, totalDays: 30 };
    }
    let min = rows[0].start;
    let max = rows[0].end;
    for (const r of rows) {
      for (const d of [r.start, r.end, r.baselineStart, r.baselineEnd]) {
        if (!d) continue;
        if (d < min) min = d;
        if (d > max) max = d;
      }
    }
    // Keep today on the chart so the "now" line always means something.
    if (today < min) min = today;
    if (today > max) max = today;
    const padded = addDays(min, -3);
    const startOfWeek = addDays(padded, -padded.getDay()); // back to Sunday
    const end = addDays(max, 4);
    return { rangeStart: startOfWeek, totalDays: Math.max(daysBetween(startOfWeek, end) + 1, 14) };
  }, [rows, today]);

  const chartWidth = totalDays * dayWidth;
  const todayOffset = daysBetween(rangeStart, today);
  const todayVisible = todayOffset >= 0 && todayOffset < totalDays;

  // Month bands across the top.
  const months = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    let i = 0;
    while (i < totalDays) {
      const d = addDays(rangeStart, i);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const span = Math.min(daysInMonth - d.getDate() + 1, totalDays - i);
      out.push({
        label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        left: i * dayWidth,
        width: span * dayWidth,
      });
      i += span;
    }
    return out;
  }, [rangeStart, totalDays, dayWidth]);

  // Tick row under the months — every day zoomed in, every week otherwise.
  const ticks = useMemo(() => {
    const out: { label: string; left: number; width: number; weekend: boolean }[] = [];
    if (zoom.key === "day") {
      for (let i = 0; i < totalDays; i++) {
        const d = addDays(rangeStart, i);
        const dow = d.getDay();
        out.push({
          label: `${d.getDate()}`,
          left: i * dayWidth,
          width: dayWidth,
          weekend: dow === 0 || dow === 6,
        });
      }
      return out;
    }
    for (let i = 0; i < totalDays; i += 7) {
      const d = addDays(rangeStart, i);
      out.push({
        label: d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
        left: i * dayWidth,
        width: 7 * dayWidth,
        weekend: false,
      });
    }
    return out;
  }, [rangeStart, totalDays, dayWidth, zoom.key]);

  function scrollToToday() {
    const el = scrollRef.current;
    if (!el || !todayVisible) return;
    el.scrollTo({
      left: Math.max(0, todayOffset * dayWidth - el.clientWidth / 2),
      behavior: "smooth",
    });
  }

  // Open on today's work rather than the start of a job that finished in March.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !todayVisible) return;
    el.scrollLeft = Math.max(0, todayOffset * dayWidth - el.clientWidth / 2);
    // Re-centering on zoom keeps the same week under the eye.
  }, [dayWidth, todayOffset, todayVisible]);

  if (rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Bars are the live dates. Ghost bars underneath are the original plan.
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {todayVisible && (
            <button
              type="button"
              onClick={scrollToToday}
              title="Jump to today"
              className="flex h-7 w-7 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:text-foreground"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            disabled={zoomIdx === 0}
            title="Zoom out"
            className="flex h-7 w-7 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-12 text-center text-[11px] text-muted-foreground">{zoom.label}</span>
          <button
            type="button"
            onClick={() => setZoomIdx((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
            disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            title="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        <div className="min-w-max">
          {/* Header — months over day/week ticks */}
          <div className="sticky top-0 z-20 flex border-b bg-card">
            <div className="sticky left-0 z-30 w-36 shrink-0 border-r bg-card sm:w-56" />
            <div className="relative shrink-0" style={{ width: chartWidth, height: 40 }}>
              <div className="relative h-5 border-b">
                {months.map((m) => (
                  <div
                    key={m.label + m.left}
                    className="absolute top-0 flex h-5 items-center overflow-hidden whitespace-nowrap border-r px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                    style={{ left: m.left, width: m.width }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              <div className="relative h-5">
                {ticks.map((t) => (
                  <div
                    key={t.left}
                    className={`absolute top-0 flex h-5 items-center justify-center overflow-hidden text-[9px] tabular-nums ${
                      t.weekend ? "bg-muted/40 text-muted-foreground/60" : "text-muted-foreground"
                    }`}
                    style={{ left: t.left, width: t.width }}
                  >
                    {t.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Rows */}
          <div className="relative">
            {rows.map((row, idx) => {
              const p = row.phase;
              const offset = daysBetween(rangeStart, row.start);
              const span = Math.max(daysBetween(row.start, row.end) + 1, 1);
              const isMilestone =
                span === 1 && MILESTONE_TYPES.has(p.event_type ?? "");
              const isOverdue = p.status !== "completed" && toKey(row.end) < toKey(today);
              const isSelected = selectedId === p.id;
              const crew = p.assigned_employee_ids?.length ?? 0;

              const baseLeft = row.baselineStart ? daysBetween(rangeStart, row.baselineStart) : null;
              const baseSpan =
                row.baselineStart && row.baselineEnd
                  ? Math.max(daysBetween(row.baselineStart, row.baselineEnd) + 1, 1)
                  : null;
              const showBaseline =
                baseLeft !== null &&
                baseSpan !== null &&
                (baseLeft !== offset || baseSpan !== span);

              return (
                <div
                  key={p.id}
                  className={`flex border-b last:border-b-0 ${
                    isSelected ? "bg-amber-500/10" : "hover:bg-muted/30"
                  }`}
                  style={{ height: ROW_H }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectPhase?.(p.id)}
                    className={`sticky left-0 z-10 flex w-36 shrink-0 items-center gap-1.5 border-r px-2 text-left sm:w-56 ${
                      isSelected ? "bg-amber-500/10" : "bg-card"
                    }`}
                    title={p.name}
                  >
                    <span
                      className="h-4 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{p.name}</span>
                    {p.is_confirmed && <Lock className="h-3 w-3 shrink-0 text-emerald-500" />}
                    {p.status === "completed" && (
                      <CheckCircle className="h-3 w-3 shrink-0 text-emerald-500" />
                    )}
                  </button>

                  <div className="relative shrink-0" style={{ width: chartWidth }}>
                    {/* grid */}
                    {ticks.map((t) => (
                      <div
                        key={t.left}
                        className={`absolute top-0 h-full border-r border-border/40 ${
                          t.weekend ? "bg-muted/30" : ""
                        }`}
                        style={{ left: t.left, width: t.width }}
                      />
                    ))}

                    {todayVisible && (
                      <div
                        className="pointer-events-none absolute top-0 z-20 h-full w-px bg-amber-500/70"
                        style={{ left: todayOffset * dayWidth + dayWidth / 2 }}
                      >
                        {idx === 0 && (
                          <span className="absolute -left-[3px] top-0 h-1.5 w-1.5 rounded-full bg-amber-500" />
                        )}
                      </div>
                    )}

                    {showBaseline && (
                      <div
                        className="absolute rounded-sm bg-muted-foreground/25"
                        style={{
                          left: baseLeft! * dayWidth + 1,
                          width: Math.max(baseSpan! * dayWidth - 2, 3),
                          top: ROW_H - 9,
                          height: 4,
                        }}
                        title={`Planned ${toKey(row.baselineStart!)} – ${toKey(row.baselineEnd!)}`}
                      />
                    )}

                    {isMilestone ? (
                      <button
                        type="button"
                        onClick={() => onSelectPhase?.(p.id)}
                        title={`${p.name} · ${toKey(row.start)}`}
                        className="absolute z-10"
                        style={{
                          left: offset * dayWidth + dayWidth / 2 - 7,
                          top: ROW_H / 2 - 10,
                        }}
                      >
                        <span
                          className={`block h-3.5 w-3.5 rotate-45 rounded-[2px] ${
                            isOverdue ? "ring-2 ring-red-500" : ""
                          }`}
                          style={{ backgroundColor: p.color }}
                        />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectPhase?.(p.id)}
                        title={`${p.name}\n${toKey(row.start)} – ${toKey(row.end)}${
                          row.shifted ? `\nshifted +${row.slipDays}d by the cascade` : ""
                        }`}
                        className={`absolute z-10 flex items-center gap-1 overflow-hidden rounded-md px-1.5 transition-all hover:brightness-110 ${
                          isOverdue ? "ring-1 ring-red-500" : ""
                        } ${isSelected ? "ring-2 ring-amber-400" : ""} ${
                          row.shifted ? "border border-dashed border-white/40" : ""
                        }`}
                        style={{
                          left: offset * dayWidth + 1,
                          width: Math.max(span * dayWidth - 2, 6),
                          top: ROW_H / 2 - 10,
                          height: 20,
                          backgroundColor: p.color,
                          opacity: p.status === "completed" ? 0.5 : p.status === "not_started" ? 0.75 : 1,
                        }}
                      >
                        {span * dayWidth > 46 && (
                          <span className="truncate text-[10px] font-medium text-white/95">
                            {crew > 0 && zoom.key === "day" ? (
                              <span className="inline-flex items-center gap-0.5">
                                <Users className="h-2.5 w-2.5" />
                                {crew}
                              </span>
                            ) : (
                              p.name
                            )}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-muted-foreground/25" /> planned (baseline)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm border border-dashed border-amber-500" /> shifted by cascade
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm ring-1 ring-red-500" /> overdue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-2.5 w-2.5 text-emerald-500" /> confirmed
        </span>
      </div>
    </div>
  );
}
