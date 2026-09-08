"use client";

import { useMemo, useRef, useState, useEffect, useId } from "react";
import {
  CheckCircle,
  Lock,
  Users,
  ZoomIn,
  ZoomOut,
  Crosshair,
  ShieldAlert,
  Share2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { usePhaseDrag, moveDate, type PhaseMove } from "./use-phase-drag";
import type { CascadeResult } from "@/lib/schedule/cascade";
import type { SequenceIssue, PhaseLink } from "@/lib/schedule/sequence-check";
import { PhasePopup, type PhasePatch, type PopupEmployee, type PhaseMutationResult } from "./phase-popup";

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
  is_manually_scheduled?: boolean;
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
  /** Crew roster for the assign picker inside the popup. */
  employees?: PopupEmployee[];
  onStatusChange?: (id: string, status: string) => PhaseMutationResult;
  /** Unlocks directly when confirmed; otherwise the parent asks who confirmed. */
  onConfirmPhase?: (id: string, currentlyConfirmed: boolean) => PhaseMutationResult;
  onMovePhase?: (id: string, start: string, end: string) => Promise<boolean>;
  onUpdatePhase?: (id: string, patch: PhasePatch) => PhaseMutationResult;
  onDeletePhase?: (id: string) => PhaseMutationResult;
  /** Escape hatch to the full list card. */
  onOpenInList?: (id: string) => void;
}

const DAY = 86400000;

/** Day width in px per zoom level. */
const ZOOM_LEVELS = [
  { key: "month", label: "Months", dayWidth: 4 },
  { key: "week", label: "Weeks", dayWidth: 12 },
  { key: "day", label: "Days", dayWidth: 30 },
] as const;

const ROW_H = 48;
const BAR_H = 28;
const NAME_W_SM = 132;
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

// A milestone is a same-day event the crew shows up for, not a run of work.
const MILESTONE_TYPES = new Set(["inspection", "meeting", "walkthrough", "shop_meeting"]);

export function ScheduleGantt({
  phases,
  cascade,
  issues,
  links,
  focus,
  employees = [],
  onStatusChange,
  onConfirmPhase,
  onUpdatePhase,
  onMovePhase,
  onDeletePhase,
  onOpenInList,
}: ScheduleGanttProps) {
  const [zoomIdx, setZoomIdx] = useState(2); // days: show each workday on opening
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArrows, setShowArrows] = useState(true);
  const [nameW, setNameW] = useState(NAME_W_LG);
  const arrowId = useId();
  const [lastFocus, setLastFocus] = useState<{ id: string; n: number } | null>(null);
  if (focus && (focus.n !== lastFocus?.n || focus.id !== lastFocus?.id)) {
    setLastFocus(focus);
    setSelectedId(focus.id);
  }
  const zoom = ZOOM_LEVELS[zoomIdx];
  const dayWidth = zoom.dayWidth;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [moveMode, setMoveMode] = useState(false);
  const { drag, saving: moving, message: moveMessage, begin: beginMove } = usePhaseDrag({
    scrollRef, dayWidth, nameWidth: nameW,
    onMove: onMovePhase ? async (move: PhaseMove) => onMovePhase(move.id, moveDate(move.start, move.days), moveDate(move.end, move.days)) : undefined,
  });

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
          c && !c.firm && c.start_date && c.end_date && (c.start_date !== p.start_date || c.end_date !== p.end_date);
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
    const out: { label: string; left: number; width: number; weekend: boolean; weekday?: string; dateLabel?: string }[] = [];
    if (zoom.key === "day") {
      for (let i = 0; i < totalDays; i++) {
        const d = addDays(rangeStart, i);
        const dow = d.getDay();
        out.push({
          label: `${d.getDate()}`,
          weekday: d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2),
          dateLabel: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
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

  /**
   * Step the window along. A day at a time zoomed in, a week otherwise.
   *
   * Assigning scrollLeft rather than scrollBy({behavior:"smooth"}) — smooth
   * scrolling is silently dropped on this container in some browsers, which
   * made both this and the today button do nothing at all.
   */
  function pan(direction: -1 | 1) {
    if (drag) return;
    const el = scrollRef.current;
    if (!el) return;
    const step = (zoom.key === "day" ? 1 : 7) * dayWidth;
    const max = el.scrollWidth - el.clientWidth;
    el.scrollLeft = Math.min(Math.max(0, el.scrollLeft + direction * step), max);
  }

  function closePopup() {
    setSelectedId(null);
  }

  function openPhase(id: string) {
    setSelectedId(id);
  }

  function changeZoom(next: number) {
    if (drag) return;
    const el = scrollRef.current;
    if (el) {
      const visibleWidth = Math.max(0, el.clientWidth - nameW);
      zoomCenter.current = (el.scrollLeft + visibleWidth / 2) / dayWidth;
    }
    setZoomIdx(next);
  }

  function scrollToToday() {
    if (drag) return;
    const el = scrollRef.current;
    if (!el || !todayVisible) return;
    const max = el.scrollWidth - el.clientWidth;
    el.scrollLeft = Math.min(Math.max(0, todayOffset * dayWidth - (el.clientWidth - nameW) / 2), max);
  }

  const zoomCenter = useRef<number | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || rows.length === 0) return;
    const visibleWidth = Math.max(0, el.clientWidth - nameW);
    if (zoomCenter.current !== null) {
      el.scrollLeft = Math.max(0, zoomCenter.current * dayWidth - visibleWidth / 2);
      zoomCenter.current = null;
    } else if (!initialized.current) {
      // Future/finished jobs open on actual work instead of a blank today column.
      const first = daysBetween(rangeStart, rows[0].start);
      const last = Math.max(...rows.map((row) => daysBetween(rangeStart, row.end)));
      const target = Math.min(Math.max(todayOffset, first), last);
      el.scrollLeft = Math.max(0, target * dayWidth - visibleWidth / 2);
      initialized.current = true;
    }
  }, [dayWidth, nameW, rangeStart, rows, todayOffset]);

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
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-amber-500 disabled:opacity-40";

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3">
        <p className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">
          {rows.length} phases - Swipe the timeline. Tap a phase for details.
        </p>
        <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto">
          <div className="flex items-center gap-1" role="group" aria-label="Navigate timeline">
          <button
            type="button"
            onClick={() => pan(-1)}
            title={zoom.key === "day" ? "Back a day" : "Back a week"}
            className={toolbarBtn}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => pan(1)}
            title={zoom.key === "day" ? "Forward a day" : "Forward a week"}
            className={toolbarBtn}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {todayVisible && (
            <button type="button" onClick={scrollToToday} title="Jump to today" className={toolbarBtn}>
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          )}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Timeline zoom">
          <button
            type="button"
            onClick={() => changeZoom(Math.max(0, zoomIdx - 1))}
            disabled={zoomIdx === 0}
            title="Zoom out"
            className={toolbarBtn}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center text-xs text-muted-foreground">{zoom.label}</span>
          <button
            type="button"
            onClick={() => changeZoom(Math.min(ZOOM_LEVELS.length - 1, zoomIdx + 1))}
            disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            title="Zoom in"
            className={toolbarBtn}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          </div>
        </div>
      </div>

      {onMovePhase && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <button type="button" aria-pressed={moveMode} disabled={Boolean(drag)}
            className={`min-h-11 rounded-xl border px-3 text-sm ${moveMode ? "border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
            onClick={() => { closePopup(); setMoveMode(v => !v); }}>
            {moveMode ? "Done moving" : "Move phases"}
          </button>
          <p role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">
            {drag ? `${moving ? "Saving" : "Move to"} ${moveDate(drag.start, drag.days)} - ${moveDate(drag.end, drag.days)}` : moveMessage ?? (moveMode ? "Drag a bar left or right. Unlock confirmed phases first." : "Turn on Move phases to drag dates. Swipe empty space to scroll.")}
          </p>
        </div>
      )}
      <div ref={scrollRef} role="region" aria-label="Project schedule timeline" tabIndex={0} className="max-h-[65dvh] overflow-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-amber-500">
        <div className="min-w-max">
          {/* Frozen labels sit above every timeline layer; the header sits above labels. */}
          {/* Header — months over day/week ticks */}
          <div className="sticky top-0 z-40 flex border-b bg-card">
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center border-r bg-card px-3 text-xs font-semibold"
              style={{ width: nameW }}>Phase</div>
            <div className="relative shrink-0" style={{ width: chartWidth }}>
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
              <div className={`relative ${zoom.key === "day" ? "h-10" : "h-5"}`}>
                {ticks.map((t) => (
                  <div
                    key={t.left}
                    title={t.dateLabel}
                    aria-label={t.dateLabel}
                    className={`absolute top-0 flex h-full flex-col items-center justify-center overflow-hidden text-[9px] tabular-nums ${
                      t.weekend ? "bg-muted/40 text-muted-foreground/60" : "text-muted-foreground"
                    }`}
                    style={{ left: t.left, width: t.width }}
                  >
                    {t.weekday && <span className="text-[10px] leading-tight">{t.weekday}</span>}
                    <span className={t.weekday ? "text-xs font-semibold leading-tight" : ""}>{t.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Rows */}
          <div className="relative">
            {/* Dependency arrows, drawn under the bars */}
            {!drag && showArrows && links && links.length > 0 && (
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute top-0"
                style={{ left: nameW, width: chartWidth, height: rows.length * ROW_H, zIndex: 5 }}
                width={chartWidth}
                height={rows.length * ROW_H}
              >
                <defs>
                  <marker id={arrowId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
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
                      markerEnd={`url(#${arrowId})`}
                      style={{ color }}
                    />
                  );
                })}
              </svg>
            )}

            {rows.map((row, idx) => {
              const p = row.phase;
              const canMove = moveMode && Boolean(onMovePhase) && !p.is_confirmed && p.status !== "completed" && !moving;
              const dragStyle = {
                touchAction: canMove ? "none" : "auto",
                cursor: canMove ? (drag?.id === p.id ? "grabbing" : "grab") : undefined,
                transform: drag?.id === p.id ? `translateX(${drag.days * dayWidth}px)` : undefined,
                transition: drag?.id === p.id ? "none" : undefined,
              };
              const pointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
                if (canMove) beginMove(e, { id: p.id, start: toKey(row.start), end: toKey(row.end) });
              };
              const clickBar = () => {
                if (!moveMode || p.is_confirmed || p.status === "completed") openPhase(p.id);
              };
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

              const pick = () => isSelected ? closePopup() : openPhase(p.id);

              return (
                <div
                  key={p.id}
                  className={`flex border-b last:border-b-0 ${
                    isSelected ? "bg-amber-500/10" : isRelated ? "bg-amber-500/[0.04]" : "hover:bg-muted/30"
                  }`}
                  style={{ height: ROW_H }}
                >
                  <button
                    type="button"
                    id={`gantt-row-${p.id}`}
                    onClick={pick}
                    aria-pressed={isSelected}
                    className={`sticky left-0 z-30 flex shrink-0 items-center gap-1.5 border-r px-2 text-left ${
                      isSelected ? "bg-card text-amber-600 dark:text-amber-400" : dimmed ? "bg-card text-muted-foreground" : "bg-card"
                    }`}
                    style={{ width: nameW }}
                    title={p.name}
                  >
                    <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="min-w-0 flex-1 line-clamp-2 break-words text-xs font-medium leading-tight">{p.name}</span>
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

                  <div className={`relative shrink-0 transition-opacity ${dimmed ? "opacity-45" : ""}`} style={{ width: chartWidth }}>
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
                        onClick={clickBar}
                        onPointerDown={pointerDown}
                        title={`${p.name} · ${toKey(row.start)}`}
                        aria-label={`${p.name}, ${toKey(row.start)}`}
                        className="absolute z-10 flex h-[44px] w-[44px] items-center justify-center"
                        style={{ ...dragStyle, left: offset * dayWidth + dayWidth / 2 - 22, top: ROW_H / 2 - 22 }}
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
                        onClick={clickBar}
                        onPointerDown={pointerDown}
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
                          ...dragStyle,
                          left: offset * dayWidth + 1,
                          width: Math.max(span * dayWidth - 2, 6),
                          top: ROW_H / 2 - BAR_H / 2,
                          height: BAR_H,
                          backgroundColor: p.color,
                          opacity: p.status === "completed" ? 0.5 : p.status === "not_started" ? 0.78 : 1,
                        }}
                      >
                        {span * dayWidth > 46 && (
                          <span className="truncate text-xs font-medium text-white">
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setShowArrows((v) => !v)}
            title={showArrows ? "Hide dependency arrows" : "Show dependency arrows"}
            aria-pressed={showArrows}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs ${showArrows ? "border-amber-500/50 text-amber-600 dark:text-amber-400" : ""}`}
          >
            <Share2 className="h-3.5 w-3.5" /> Dependencies
          </button>

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

      {selected && (
        <PhasePopup
          key={selected.phase.id}
          phase={selected.phase}
          displayedDates={{ start: toKey(selected.start), end: toKey(selected.end) }}
          issues={issues?.get(selected.phase.id) ?? []}
          predecessors={predecessors}
          successors={successors}
          nameOf={nameOf}
          employees={employees}
          onSelectPhase={(id) => {
            // Walking the chain replaces the sheet contents without moving the chart.
            setSelectedId(id);
          }}
          onClose={closePopup}
          onStatusChange={onStatusChange}
          onConfirmPhase={onConfirmPhase}
          onUpdatePhase={onUpdatePhase}
          onDeletePhase={onDeletePhase}
          onOpenInList={onOpenInList}
        />
      )}
    </div>
  );
}
