"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import {
  CheckCircle,
  Lock,
  Users,
  ZoomIn,
  ZoomOut,
  Crosshair,
  ShieldAlert,
  Share2,
  Pencil,
  X,
  ArrowRight,
} from "lucide-react";
import type { CascadeResult } from "@/lib/schedule/cascade";
import type { SequenceIssue, PhaseLink } from "@/lib/schedule/sequence-check";

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
  notes?: string | null;
  is_confirmed?: boolean;
  confirmed_with?: string | null;
  assigned_employee_ids?: string[];
}

interface ScheduleGanttProps {
  phases: GanttPhase[];
  /** Live cascade — unconfirmed phases slide with the slip ahead of them. */
  cascade?: Map<string, CascadeResult>;
  /** Sequencing problems, keyed by phase — the bar rings red where the order is wrong. */
  issues?: Map<string, SequenceIssue[]>;
  /** What waits on what, drawn as arrows between bars. */
  links?: PhaseLink[];
  /**
   * Ask the chart to open a phase from outside — the sequence-check panel
   * points at one. Carries a nonce so picking the same phase twice re-opens it.
   */
  focus?: { id: string; n: number } | null;
  /** Editing lives on the list card; the chart only ever asks to go there. */
  onOpenInList?: (id: string) => void;
}

const DAY = 86400000;

/** Day width in px per zoom level. */
const ZOOM_LEVELS = [
  { key: "month", label: "Months", dayWidth: 4 },
  { key: "week", label: "Weeks", dayWidth: 12 },
  { key: "day", label: "Days", dayWidth: 30 },
] as const;

const ROW_H = 34;
const BAR_H = 20;
const NAME_W_SM = 144;
const NAME_W_LG = 224;

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

function pretty(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// A milestone is a same-day event the crew shows up for, not a run of work.
const MILESTONE_TYPES = new Set(["inspection", "meeting", "walkthrough", "shop_meeting"]);

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Done",
  on_hold: "On hold",
};

export function ScheduleGantt({
  phases,
  cascade,
  issues,
  links,
  focus,
  onOpenInList,
}: ScheduleGanttProps) {
  const [zoomIdx, setZoomIdx] = useState(1); // weeks
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArrows, setShowArrows] = useState(true);
  const [nameW, setNameW] = useState(NAME_W_LG);
  // The sequence-check panel can point the chart at a phase. Adjust during
  // render rather than in an effect — no second paint, no stale flash.
  const [lastFocus, setLastFocus] = useState(0);
  if (focus && focus.n !== lastFocus) {
    setLastFocus(focus.n);
    setSelectedId(focus.id);
  }
  const zoom = ZOOM_LEVELS[zoomIdx];
  const dayWidth = zoom.dayWidth;
  const scrollRef = useRef<HTMLDivElement>(null);

  // The name column is narrower on a phone, and the arrow layer has to start
  // exactly where it ends.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => setNameW(mq.matches ? NAME_W_LG : NAME_W_SM);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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
          a.start.getTime() - b.start.getTime() || a.phase.sort_order - b.phase.sort_order
      );
  }, [phases, cascade]);

  // Chart window: the whole job plus its baselines, padded to clean weeks.
  const { rangeStart, totalDays } = useMemo(() => {
    if (rows.length === 0) return { rangeStart: today, totalDays: 30 };
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

  /** Where each bar sits, so arrows and the detail panel agree with the chart. */
  const geo = useMemo(() => {
    const m = new Map<
      string,
      { idx: number; left: number; right: number; cy: number; milestone: boolean }
    >();
    rows.forEach((row, idx) => {
      const offset = daysBetween(rangeStart, row.start);
      const span = Math.max(daysBetween(row.start, row.end) + 1, 1);
      const milestone = span === 1 && MILESTONE_TYPES.has(row.phase.event_type ?? "");
      const center = offset * dayWidth + dayWidth / 2;
      const left = milestone ? center - 8 : offset * dayWidth + 1;
      const right = milestone ? center + 8 : left + Math.max(span * dayWidth - 2, 6);
      m.set(row.phase.id, { idx, left, right, cy: idx * ROW_H + ROW_H / 2, milestone });
    });
    return m;
  }, [rows, rangeStart, dayWidth]);

  const selected = selectedId ? rows.find((r) => r.phase.id === selectedId) ?? null : null;
  const predecessors = useMemo(
    () => (selectedId ? (links ?? []).filter((l) => l.toId === selectedId) : []),
    [links, selectedId]
  );
  const successors = useMemo(
    () => (selectedId ? (links ?? []).filter((l) => l.fromId === selectedId) : []),
    [links, selectedId]
  );
  const relatedIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of predecessors) s.add(l.fromId);
    for (const l of successors) s.add(l.toId);
    return s;
  }, [predecessors, successors]);

  const nameOf = (id: string) => rows.find((r) => r.phase.id === id)?.phase.name ?? "";

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
  }, [dayWidth, todayOffset, todayVisible]);

  if (rows.length === 0) return null;

  /** Elbow from the end of one bar into the start of the next. */
  function arrowPath(from: { right: number; cy: number }, to: { left: number; cy: number }) {
    const x1 = from.right;
    const y1 = from.cy;
    const x2 = to.left - 5;
    const y2 = to.cy;
    const stub = 9;
    // When the successor starts before its predecessor ends, the elbow doubles
    // back — which is exactly what that mistake looks like.
    const midX = Math.max(x1 + stub, x2 - stub);
    return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
  }

  const toolbarBtn =
    "flex h-7 w-7 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40";

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          Tap a bar to see what it waits on. Ghost bars are the original plan.
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setShowArrows((v) => !v)}
            title={showArrows ? "Hide dependency arrows" : "Show dependency arrows"}
            aria-pressed={showArrows}
            className={`${toolbarBtn} ${showArrows ? "border-amber-500/50 text-amber-500" : ""}`}
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
          {todayVisible && (
            <button type="button" onClick={scrollToToday} title="Jump to today" className={toolbarBtn}>
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            disabled={zoomIdx === 0}
            title="Zoom out"
            className={toolbarBtn}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-12 text-center text-[11px] text-muted-foreground">{zoom.label}</span>
          <button
            type="button"
            onClick={() => setZoomIdx((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
            disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            title="Zoom in"
            className={toolbarBtn}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        <div className="min-w-max">
          {/* Header — months over day/week ticks */}
          <div className="sticky top-0 z-20 flex border-b bg-card">
            <div
              className="sticky left-0 z-30 shrink-0 border-r bg-card"
              style={{ width: nameW }}
            />
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
            {/* Dependency arrows, drawn under the bars */}
            {showArrows && links && links.length > 0 && (
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute top-0"
                style={{ left: nameW, width: chartWidth, height: rows.length * ROW_H, zIndex: 5 }}
                width={chartWidth}
                height={rows.length * ROW_H}
              >
                <defs>
                  <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
                  </marker>
                </defs>
                {links.map((l, i) => {
                  const f = geo.get(l.fromId);
                  const t = geo.get(l.toId);
                  if (!f || !t) return null;
                  const isLive = selectedId === l.fromId || selectedId === l.toId;
                  // Red only where the CHECKER found a conflict. Bars that
                  // merely overlap — the plumber starting while the framer
                  // finishes — are a normal week, not a mistake, and an arrow
                  // shouldn't claim otherwise.
                  const broken = (issues?.get(l.toId) ?? []).some((i) => i.severity === "conflict");
                  const color = broken ? "rgb(239 68 68)" : isLive ? "rgb(245 158 11)" : "currentColor";
                  return (
                    <path
                      key={`${l.fromId}-${l.toId}-${i}`}
                      d={arrowPath(f, t)}
                      fill="none"
                      stroke={color}
                      strokeWidth={isLive ? 1.6 : 1}
                      className={isLive || broken ? "" : "text-muted-foreground"}
                      opacity={selectedId ? (isLive ? 1 : 0.12) : broken ? 0.85 : 0.34}
                      markerEnd="url(#gantt-arrow)"
                      style={{ color }}
                    />
                  );
                })}
              </svg>
            )}

            {rows.map((row, idx) => {
              const p = row.phase;
              const offset = daysBetween(rangeStart, row.start);
              const span = Math.max(daysBetween(row.start, row.end) + 1, 1);
              const isMilestone = span === 1 && MILESTONE_TYPES.has(p.event_type ?? "");
              const isOverdue = p.status !== "completed" && toKey(row.end) < toKey(today);
              const isSelected = selectedId === p.id;
              const isRelated = relatedIds.has(p.id);
              const dimmed = Boolean(selectedId) && !isSelected && !isRelated;
              const crew = p.assigned_employee_ids?.length ?? 0;
              const phaseIssues = issues?.get(p.id) ?? [];
              const hasConflict = phaseIssues.some((i) => i.severity === "conflict");
              const outOfOrder = phaseIssues.length > 0;

              const baseLeft = row.baselineStart ? daysBetween(rangeStart, row.baselineStart) : null;
              const baseSpan =
                row.baselineStart && row.baselineEnd
                  ? Math.max(daysBetween(row.baselineStart, row.baselineEnd) + 1, 1)
                  : null;
              const showBaseline =
                baseLeft !== null && baseSpan !== null && (baseLeft !== offset || baseSpan !== span);

              const pick = () => setSelectedId(isSelected ? null : p.id);

              return (
                <div
                  key={p.id}
                  className={`flex border-b last:border-b-0 transition-opacity ${
                    isSelected ? "bg-amber-500/10" : isRelated ? "bg-amber-500/[0.04]" : "hover:bg-muted/30"
                  } ${dimmed ? "opacity-45" : ""}`}
                  style={{ height: ROW_H }}
                >
                  <button
                    type="button"
                    onClick={pick}
                    aria-pressed={isSelected}
                    className={`sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r px-2 text-left ${
                      isSelected ? "bg-amber-500/10" : "bg-card"
                    }`}
                    style={{ width: nameW }}
                    title={p.name}
                  >
                    <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{p.name}</span>
                    {outOfOrder && (
                      <ShieldAlert
                        className={`h-3 w-3 shrink-0 ${hasConflict ? "text-red-400" : "text-amber-500"}`}
                      />
                    )}
                    {p.is_confirmed && <Lock className="h-3 w-3 shrink-0 text-emerald-500" />}
                    {p.status === "completed" && (
                      <CheckCircle className="h-3 w-3 shrink-0 text-emerald-500" />
                    )}
                  </button>

                  <div className="relative shrink-0" style={{ width: chartWidth }}>
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
                        onClick={pick}
                        title={`${p.name} · ${toKey(row.start)}`}
                        className="absolute z-10"
                        style={{ left: offset * dayWidth + dayWidth / 2 - 7, top: ROW_H / 2 - 10 }}
                      >
                        <span
                          className={`block h-3.5 w-3.5 rotate-45 rounded-[2px] ${
                            isSelected
                              ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-card"
                              : hasConflict
                                ? "ring-2 ring-red-500"
                                : outOfOrder
                                  ? "ring-2 ring-amber-500"
                                  : isOverdue
                                    ? "ring-2 ring-red-500"
                                    : ""
                          }`}
                          style={{ backgroundColor: p.color }}
                        />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={pick}
                        title={`${p.name}\n${toKey(row.start)} – ${toKey(row.end)}`}
                        className={`absolute z-10 flex items-center gap-1 overflow-hidden rounded-md px-1.5 transition-all hover:brightness-110 ${
                          isSelected
                            ? "ring-2 ring-amber-400"
                            : hasConflict
                              ? "ring-2 ring-red-500"
                              : outOfOrder
                                ? "ring-2 ring-amber-500"
                                : isOverdue
                                  ? "ring-1 ring-red-500"
                                  : ""
                        } ${row.shifted ? "border border-dashed border-white/40" : ""}`}
                        style={{
                          left: offset * dayWidth + 1,
                          width: Math.max(span * dayWidth - 2, 6),
                          top: ROW_H / 2 - BAR_H / 2,
                          height: BAR_H,
                          backgroundColor: p.color,
                          opacity: p.status === "completed" ? 0.5 : p.status === "not_started" ? 0.78 : 1,
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

      {/* Detail — opens right here, the chart never swaps out from under you */}
      {selected && (
        <div className="border-t bg-muted/20 px-3 py-3">
          <div className="flex items-start gap-2">
            <span
              className="mt-1 h-8 w-1 shrink-0 rounded-full"
              style={{ backgroundColor: selected.phase.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">{selected.phase.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                <span className="tabular-nums">
                  {pretty(selected.start)} – {pretty(selected.end)}
                </span>
                <span>·</span>
                <span>{daysBetween(selected.start, selected.end) + 1} days</span>
                <span>·</span>
                <span>{STATUS_LABEL[selected.phase.status] ?? selected.phase.status}</span>
                {selected.phase.is_confirmed && (
                  <span className="inline-flex items-center gap-1 text-emerald-500">
                    <Lock className="h-3 w-3" />
                    Firm
                    {selected.phase.confirmed_with ? ` · ${selected.phase.confirmed_with}` : ""}
                  </span>
                )}
                {(selected.phase.assigned_employee_ids?.length ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {selected.phase.assigned_employee_ids!.length}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
              className="shrink-0 rounded-lg border p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {(issues?.get(selected.phase.id) ?? []).length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {(issues?.get(selected.phase.id) ?? []).map((iss, i) => (
                <li key={i} className="flex items-start gap-2 text-[11.5px] leading-relaxed">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      iss.severity === "conflict" ? "bg-red-400" : "bg-amber-500"
                    }`}
                  />
                  <span className={iss.severity === "conflict" ? "text-red-300" : "text-amber-400"}>
                    {iss.message}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {(predecessors.length > 0 || successors.length > 0) && (
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {predecessors.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Waits on
                  </p>
                  <ul className="space-y-1">
                    {predecessors.map((l, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(l.fromId)}
                          className="w-full rounded-lg border bg-card px-2 py-1.5 text-left transition-colors hover:border-amber-500/50"
                        >
                          <span className="block truncate text-[11.5px] font-medium">
                            {nameOf(l.fromId)}
                          </span>
                          <span className="block text-[10.5px] text-muted-foreground">{l.reason}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {successors.length > 0 && (
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Holds up <ArrowRight className="h-3 w-3" />
                  </p>
                  <ul className="space-y-1">
                    {successors.map((l, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(l.toId)}
                          className="w-full rounded-lg border bg-card px-2 py-1.5 text-left transition-colors hover:border-amber-500/50"
                        >
                          <span className="block truncate text-[11.5px] font-medium">
                            {nameOf(l.toId)}
                          </span>
                          <span className="block text-[10.5px] text-muted-foreground">{l.reason}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {selected.phase.notes && (
            <p className="mt-2.5 rounded-lg bg-muted/40 px-2.5 py-2 text-[11.5px] text-muted-foreground">
              {selected.phase.notes}
            </p>
          )}

          {onOpenInList && (
            <button
              type="button"
              onClick={() => onOpenInList(selected.phase.id)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              Edit dates &amp; crew
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-muted-foreground/25" /> planned (baseline)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden="true">
            <path d="M0,4 H14" stroke="currentColor" strokeWidth="1" opacity=".5" />
            <path d="M13,1 L17,4 L13,7 Z" fill="currentColor" opacity=".5" />
          </svg>
          waits on
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm ring-1 ring-red-500" /> overdue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldAlert className="h-2.5 w-2.5 text-red-400" /> out of sequence
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-2.5 w-2.5 text-emerald-500" /> confirmed
        </span>
      </div>
    </div>
  );
}
