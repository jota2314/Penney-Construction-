"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarOff,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  CloudRain,
  Flag,
  Maximize2,
  Package,
  Plus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardBar, BoardData, BoardDay, BoardJob, BoardPayment } from "@/lib/board/board-data";
import { checkSequence, issuesByPhase, type SequenceIssue } from "@/lib/schedule/sequence-check";
import type { ProjectHealth } from "./job-board";

/**
 * The Jobs view — every job as one tight row, every row a Gantt you can open.
 *
 * Collapsed, a job is its steps packed into at most three thin lanes, with
 * what's on now, what's next and what's wrong written beside it — so the whole
 * company fits on a screen. Open it (chevron, or "whole job") and the same row
 * unfolds into one line per step: a real Gantt, sized to the window.
 *
 * Moving things is the point:
 *   drag a bar            move it
 *   drag either end       stretch it
 *   shift / ⌘-click       pick several, then drag any one to move them all
 *   alt-drag              move a step and everything after it on that job
 *   double-click a row    add a step on that day
 *
 * Nothing slides by itself. The sequence checker rings a bar when its order
 * can't work; the date stays the office's call.
 */

export const NAME_W = 264;
/** Strip at the top of a job row for draws, the finish flag, orders and todos. */
const BAND_H = 16;
const LANE_H = 20;
const BAR_H = 16;
/** One step per line when a job is open. */
const STEP_H = 26;
const COLLAPSED_LANES = 3;
const MIN_ROW_H = 62;
/** Grab zone at each end of a bar for stretching. */
const EDGE = 7;
/** Pixels of travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 5;

export interface TimelineControl {
  /** Scroll so `date` sits at the left edge (today gets two days of lead-in). */
  scrollToDate: (date: string) => void;
  /** Page the window by roughly one screen. */
  page: (dir: 1 | -1) => void;
  /** Scroll a job's row up under the header. */
  revealJob: (jobId: string) => void;
}

export interface MoveOptions {
  /** Several bars moved as one (a pick or "everything after") — not a single bar. */
  group?: boolean;
  /** "Everything after" on this job: its steps past the window move too. */
  tailJobId?: string | null;
}

export interface BarMove {
  bar: BoardBar;
  start: string;
  end: string;
}

type DragMode = "move" | "start" | "end";

interface DragState {
  anchorId: string;
  bars: BoardBar[];
  /** Started from a pick or an alt-drag. */
  group: boolean;
  /** Captured at mousedown: the job whose steps past the window ride along. */
  tailJobId: string | null;
  mode: DragMode;
  originX: number;
  delta: number;
  moved: boolean;
}

interface Props {
  data: BoardData;
  onsite: BoardJob[];
  starting: BoardJob[];
  pipeline: BoardJob[];
  health: Map<string, ProjectHealth>;
  /** How many days the window shows at once — the day width follows. */
  visibleDays: number;
  expanded: Set<string>;
  onToggleExpand: (jobId: string) => void;
  selection: Set<string>;
  /** Set when the pick is "a step and everything after" on that job. */
  selectionTail: string | null;
  /** Every bar, search filter or not — a pick moves whole even when part of it is filtered out. */
  allBars: BoardBar[];
  /** `tailJobId`: the pick is "a step and everything after" on that job. */
  onSelectionChange: (next: Set<string>, tailJobId?: string) => void;
  onOpenProject: (projectId: string) => void;
  onOpenPhase: (bar: BoardBar) => void;
  onMoveBars: (moves: BarMove[], opts?: MoveOptions) => void;
  onAddStep: (projectId: string, date: string) => void;
  onFitJob: (job: BoardJob) => void;
  controlRef: React.MutableRefObject<TimelineControl | null>;
}

// ── Small helpers ────────────────────────────────────────────────

export function shiftDate(date: string, days: number) {
  if (days === 0) return date;
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function money(n: number | null) {
  if (n === null) return null;
  const abs = Math.abs(n);
  return abs >= 1000 ? `$${Math.round(abs / 1000)}K` : `$${Math.round(abs)}`;
}

function shortDay(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

function firstName(name: string) {
  return name.split(/\s+/)[0] ?? name;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Greedy interval packing: each bar drops into the first lane it doesn't
 * collide with, so two steps in the same week stack instead of overlapping.
 */
function packBars(bars: BoardBar[]): { bar: BoardBar; lane: number }[] {
  const laneEnds: number[] = [];
  const sorted = [...bars].sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);
  return sorted.map((bar) => {
    let lane = laneEnds.findIndex((end) => end < bar.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bar.endCol);
    } else {
      laneEnds[lane] = bar.endCol;
    }
    return { bar, lane };
  });
}

/** Order for an open job: by start, the job's own steps above crew days. */
function stepOrder(a: BoardBar, b: BoardBar) {
  const kind = (k: BoardBar["kind"]) => (k === "plan" ? 0 : k === "sub" ? 1 : 2);
  return a.startDate.localeCompare(b.startDate) || kind(a.kind) - kind(b.kind) || a.endDate.localeCompare(b.endDate);
}

function gridBackground(days: BoardDay[], dayW: number) {
  const firstDow = new Date(`${days[0].str}T12:00:00`).getDay();
  const satOffset = (6 - firstDow + 7) % 7;
  return {
    backgroundImage: [
      `repeating-linear-gradient(to right, transparent 0 ${dayW - 1}px, color-mix(in oklab, var(--border) 70%, transparent) ${dayW - 1}px ${dayW}px)`,
      `repeating-linear-gradient(to right, rgb(120 120 120 / 0.09) 0 ${2 * dayW}px, transparent ${2 * dayW}px ${7 * dayW}px)`,
    ].join(","),
    backgroundPosition: `0 0, ${satOffset * dayW}px 0`,
  };
}

// ── Component ────────────────────────────────────────────────────

export function BoardTimeline({
  data,
  onsite,
  starting,
  pipeline,
  health,
  visibleDays,
  expanded,
  onToggleExpand,
  selection,
  selectionTail,
  allBars,
  onSelectionChange,
  onOpenProject,
  onOpenPhase,
  onMoveBars,
  onAddStep,
  onFitJob,
  controlRef,
}: Props) {
  const { days } = data;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const pan = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);
  /** Outlives the pan itself: mouseup clears `pan` before the click arrives. */
  const panMoved = useRef(false);
  /** Day index at the left edge — kept so zooming doesn't lose your place. */
  const leftIdx = useRef<number | null>(null);
  /** The month at the left edge, so the header always says where you are. */
  const [edgeMonth, setEdgeMonth] = useState("");

  const todayIdx = useMemo(() => days.findIndex((d) => d.isToday), [days]);
  const dayW = useMemo(() => {
    if (!width) return 40;
    return Math.max(10, Math.floor((width - NAME_W - 2) / Math.max(1, visibleDays)));
  }, [width, visibleDays]);
  const trackW = days.length * dayW;

  // Fit the day width to the screen.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const syncEdge = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.min(days.length - 1, Math.max(0, Math.round(el.scrollLeft / dayW)));
    const d = days[idx];
    if (!d) return;
    const label = new Date(`${d.str}T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    setEdgeMonth((prev) => (prev === label ? prev : label));
  }, [days, dayW]);

  // Open on today; after a zoom, keep the same day at the left edge.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !width) return;
    const idx = leftIdx.current ?? Math.max(0, todayIdx - 2);
    el.scrollLeft = idx * dayW;
    leftIdx.current = idx;
    syncEdge();
  }, [dayW, width, todayIdx, syncEdge]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) leftIdx.current = Math.round(el.scrollLeft / dayW);
    syncEdge();
  };

  useEffect(() => {
    controlRef.current = {
      scrollToDate: (date: string) => {
        const el = scrollRef.current;
        if (!el) return;
        let idx = days.findIndex((d) => d.str >= date);
        if (idx < 0) idx = days.length - 1;
        if (date === data.todayStr) idx = Math.max(0, idx - 2);
        leftIdx.current = idx;
        el.scrollTo({ left: idx * dayW, behavior: "smooth" });
      },
      page: (dir) => {
        const el = scrollRef.current;
        if (!el) return;
        const step = Math.max(1, visibleDays - 1) * dayW;
        el.scrollBy({ left: dir * step, behavior: "smooth" });
      },
      revealJob: (jobId) => {
        const el = scrollRef.current;
        const row = el?.querySelector<HTMLElement>(`[data-job="${jobId}"]`);
        if (!el || !row) return;
        const header = el.querySelector<HTMLElement>("[data-board-header]")?.offsetHeight ?? 60;
        const top = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - header - 4;
        el.scrollTop = top;
      },
    };
  }, [controlRef, days, dayW, visibleDays, data.todayStr]);

  // Every bar by id — a drag on one selected bar carries the rest, including
  // picked bars the search box is hiding (the arrow keys move those too).
  const barById = useMemo(() => new Map(allBars.map((b) => [b.id, b])), [allBars]);

  // Sequence problems per job, from its own plan steps only.
  const issues = useMemo(() => {
    const out = new Map<string, SequenceIssue[]>();
    for (const j of [...onsite, ...starting]) {
      const plan = j.bars.filter((b) => b.kind === "plan" && b.phaseScope === "master");
      if (plan.length < 2) continue;
      const found = checkSequence(
        plan.map((b) => ({
          id: b.id,
          name: b.name,
          start_date: b.startDate,
          end_date: b.endDate,
          event_type: b.eventType,
          phase_scope: b.phaseScope,
          status: b.status,
        })),
      );
      for (const [id, list] of issuesByPhase(found)) out.set(id, list);
    }
    return out;
  }, [onsite, starting]);

  // ── Drag ───────────────────────────────────────────────────────

  /**
   * Listeners go on the window synchronously, inside mousedown — an effect
   * runs after paint, and a quick click released before that frame never saw
   * its own mouseup (the bar wouldn't open and the drag stayed latched).
   */
  const beginDrag = useCallback(
    (
      anchor: BoardBar,
      group: BoardBar[],
      mode: DragMode,
      clientX: number,
      isGroup = false,
      tailJobId: string | null = null,
    ) => {
      releaseRef.current?.();
      const state: DragState = {
        anchorId: anchor.id,
        bars: group,
        group: isGroup,
        tailJobId,
        mode,
        originX: clientX,
        delta: 0,
        moved: false,
      };
      dragRef.current = state;
      setDrag(state);

      const onMove = (e: MouseEvent) => {
        const cur = dragRef.current;
        if (!cur) return;
        const dx = e.clientX - cur.originX;
        // A drag has to be deliberate, so a twitchy hand can't reschedule a crew.
        if (!cur.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
        let delta = Math.round(dx / dayW);
        const span = Math.round(
          (new Date(`${anchor.endDate}T12:00:00`).getTime() -
            new Date(`${anchor.startDate}T12:00:00`).getTime()) /
            86400000,
        );
        if (cur.mode === "start") delta = Math.min(delta, span);
        if (cur.mode === "end") delta = Math.max(delta, -span);
        if (cur.moved && delta === cur.delta) return;
        const next = { ...cur, delta, moved: true };
        dragRef.current = next;
        setDrag(next);
      };

      const release = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("blur", release);
        releaseRef.current = null;
        dragRef.current = null;
        setDrag(null);
      };

      const onUp = () => {
        const cur = dragRef.current;
        release();
        if (!cur) return;
        if (!cur.moved || cur.delta === 0) {
          if (!cur.moved) onOpenPhase(anchor);
          return;
        }
        const moves: BarMove[] = cur.bars.map((b) => ({
          bar: b,
          start: cur.mode === "end" ? b.startDate : shiftDate(b.startDate, cur.delta),
          end: cur.mode === "start" ? b.endDate : shiftDate(b.endDate, cur.delta),
        }));
        onMoveBars(moves, { group: cur.group, tailJobId: cur.tailJobId });
      };

      releaseRef.current = release;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("blur", release);
    },
    [dayW, onMoveBars, onOpenPhase],
  );

  useEffect(() => () => releaseRef.current?.(), []);

  const onBarMouseDown = (e: React.MouseEvent, bar: BoardBar, job: BoardJob, barWidth: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // Shift / ⌘ / Ctrl: build a selection, don't drag.
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const next = new Set(selection);
      if (next.has(bar.id)) next.delete(bar.id);
      else next.add(bar.id);
      onSelectionChange(next);
      return;
    }

    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    // A clipped edge is the window's edge, not the step's real date, so it
    // can't be stretched; grabbing there just moves the bar.
    const canStretch = !bar.isMilestone && barWidth > EDGE * 3;
    const canStart = canStretch && !bar.clippedStart;
    const canEnd = canStretch && !bar.clippedEnd;
    const mode: DragMode =
      canStart && x < EDGE ? "start" : canEnd && x > barWidth - EDGE ? "end" : "move";

    // Alt: this step and everything after it on the job, still open.
    if (e.altKey && mode === "move") {
      const after = job.bars.filter(
        (b) => b.kind === "plan" && b.status !== "completed" && b.startDate >= bar.startDate,
      );
      const group = after.some((b) => b.id === bar.id) ? after : [bar, ...after];
      onSelectionChange(new Set(group.map((b) => b.id)), job.id);
      beginDrag(bar, group, "move", e.clientX, true, job.id);
      return;
    }

    // A pick moves together — even a pick of one, when it's "everything
    // after" the job's last step on screen (its tail is past the window).
    if (mode === "move" && selection.has(bar.id) && (selection.size > 1 || selectionTail)) {
      const group = Array.from(selection)
        .map((id) => barById.get(id))
        .filter((b): b is BoardBar => !!b);
      beginDrag(bar, group, "move", e.clientX, true, selectionTail);
      return;
    }

    if (selection.size && !selection.has(bar.id)) onSelectionChange(new Set());
    beginDrag(bar, [bar], mode, e.clientX);
  };

  /** Where a bar is drawn right now — including a drag in flight. */
  const offsets = (bar: BoardBar) => {
    if (!drag || !drag.moved || !drag.bars.some((b) => b.id === bar.id)) return { s: 0, e: 0 };
    if (drag.mode === "start") return { s: drag.delta, e: 0 };
    if (drag.mode === "end") return { s: 0, e: drag.delta };
    return { s: drag.delta, e: drag.delta };
  };

  // ── Pan the window by dragging empty space ─────────────────────

  const onMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || e.button !== 0 || drag) return;
    pan.current = { startX: e.clientX, startLeft: el.scrollLeft, moved: false };
    panMoved.current = false;
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || !pan.current || drag) return;
    const dx = e.clientX - pan.current.startX;
    if (Math.abs(dx) > 3) {
      pan.current.moved = true;
      panMoved.current = true;
    }
    if (pan.current.moved) el.scrollLeft = pan.current.startLeft - dx;
  };
  const endPan = () => {
    pan.current = null;
    // A release outside any button never produces a click; don't let the
    // flag swallow the next real one.
    window.setTimeout(() => {
      panMoved.current = false;
    }, 0);
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (panMoved.current) {
      e.preventDefault();
      e.stopPropagation();
      panMoved.current = false;
    }
  };

  const dateAt = (e: React.MouseEvent) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const idx = Math.max(0, Math.min(days.length - 1, Math.floor(x / dayW)));
    return days[idx].str;
  };

  const regional = data.weather[data.defaultSite] ?? {};
  const showWeather = dayW >= 26;

  const renderJob = (job: BoardJob) => {
    const isOpen = expanded.has(job.id);
    const jobIssues = job.bars.flatMap((b) => issues.get(b.id) ?? []);
    const conflicts = jobIssues.filter((i) => i.severity === "conflict").length;

    if (!isOpen) {
      const packed = packBars(job.bars);
      const shown = packed.filter((p) => p.lane < COLLAPSED_LANES);
      const hidden = packed.length - shown.length;
      const lanes = Math.max(1, Math.min(COLLAPSED_LANES, ...packed.map((p) => p.lane + 1)));
      const height = Math.max(MIN_ROW_H, BAND_H + 4 + lanes * LANE_H + 8);
      return (
        <div key={job.id} data-job={job.id} className="flex">
          <NameCell
            job={job}
            health={health.get(job.id)}
            height={height}
            open={false}
            hidden={hidden}
            conflicts={conflicts}
            onToggle={() => onToggleExpand(job.id)}
            onOpen={() => onOpenProject(job.id)}
            onFit={() => onFitJob(job)}
          />
          <Track
            data={data}
            job={job}
            dayW={dayW}
            height={height}
            onDoubleClick={(e) => onAddStep(job.id, dateAt(e))}
          >
            <Band job={job} days={days} dayW={dayW} onOpen={() => onOpenProject(job.id)} />
            {shown.map(({ bar, lane }) => (
              <BarView
                key={bar.id}
                bar={bar}
                dayW={dayW}
                top={BAND_H + 4 + lane * LANE_H}
                height={BAR_H}
                offset={offsets(bar)}
                selected={selection.has(bar.id)}
                dragging={!!drag?.moved && drag.bars.some((b) => b.id === bar.id)}
                issues={issues.get(bar.id)}
                onMouseDown={(e, w) => onBarMouseDown(e, bar, job, w)}
              />
            ))}
            <WorkedTicks job={job} days={days} dayW={dayW} />
          </Track>
        </div>
      );
    }

    // Open: one line per step — the job's own Gantt.
    const steps = [...job.bars].sort(stepOrder);
    const headH = 44;
    return (
      <div key={job.id} data-job={job.id} className="border-b border-primary/30">
        <div className="flex">
          <NameCell
            job={job}
            health={health.get(job.id)}
            height={headH}
            open
            hidden={0}
            conflicts={conflicts}
            onToggle={() => onToggleExpand(job.id)}
            onOpen={() => onOpenProject(job.id)}
            onFit={() => onFitJob(job)}
          />
          <Track
            data={data}
            job={job}
            dayW={dayW}
            height={headH}
            onDoubleClick={(e) => onAddStep(job.id, dateAt(e))}
          >
            <Band job={job} days={days} dayW={dayW} onOpen={() => onOpenProject(job.id)} />
            <WorkedTicks job={job} days={days} dayW={dayW} />
          </Track>
        </div>
        {steps.map((bar) => (
          <div key={bar.id} className="flex">
            <StepCell
              bar={bar}
              issues={issues.get(bar.id)}
              selected={selection.has(bar.id)}
              onOpen={() => onOpenPhase(bar)}
            />
            <Track
              data={data}
              job={job}
              dayW={dayW}
              height={STEP_H}
              quiet
              onDoubleClick={(e) => onAddStep(job.id, dateAt(e))}
            >
              <BarView
                bar={bar}
                dayW={dayW}
                top={4}
                height={STEP_H - 8}
                showPlanned
                offset={offsets(bar)}
                selected={selection.has(bar.id)}
                dragging={!!drag?.moved && drag.bars.some((b) => b.id === bar.id)}
                issues={issues.get(bar.id)}
                onMouseDown={(e, w) => onBarMouseDown(e, bar, job, w)}
              />
            </Track>
          </div>
        ))}
        <div className="flex">
          <div
            className="sticky left-0 z-20 shrink-0 border-r border-b border-border bg-card px-3 py-1"
            style={{ width: NAME_W }}
          >
            <button
              type="button"
              onClick={() => onAddStep(job.id, data.todayStr)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3 w-3" aria-hidden />
              Add step
            </button>
            {steps.length === 0 && (
              <span className="ml-2 text-[11px] text-muted-foreground">Nothing in this window.</span>
            )}
          </div>
          <div className="shrink-0 border-b border-border/60" style={{ width: trackW }} />
        </div>
      </div>
    );
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endPan}
      onMouseLeave={endPan}
      onClickCapture={onClickCapture}
      className={cn(
        "min-h-0 flex-1 select-none overflow-auto overscroll-x-contain rounded-lg border border-border bg-card",
        drag?.moved && "cursor-grabbing",
      )}
    >
      <div style={{ width: NAME_W + trackW }}>
        {/* ── Header: months, days, weather ── */}
        <div data-board-header className="sticky top-0 z-30 bg-card shadow-[0_1px_0_var(--border)]">
          <div className="flex h-5">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-card px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/80"
              style={{ width: NAME_W }}
            >
              {edgeMonth}
            </div>
            <div className="relative shrink-0" style={{ width: trackW }}>
              {days.map((d, i) =>
                d.monthLabel ? (
                  <span
                    key={d.str}
                    className="absolute top-1 whitespace-nowrap border-l border-border pl-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                    style={{ left: i * dayW }}
                  >
                    {d.monthLabel}
                  </span>
                ) : null,
              )}
            </div>
          </div>
          <div className="flex">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-end border-r border-border bg-card px-3 pb-1"
              style={{ width: NAME_W }}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Job · now · next
              </span>
            </div>
            <div className="flex shrink-0" style={{ width: trackW }}>
              {days.map((d) => (
                <DayHead key={d.str} day={d} dayW={dayW} />
              ))}
            </div>
          </div>
          {showWeather && (
            <div className="flex">
              <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-card px-3" style={{ width: NAME_W }}>
                <CloudRain className="h-3 w-3 text-muted-foreground" aria-hidden />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  North Shore
                </span>
              </div>
              <div className="flex shrink-0" style={{ width: trackW }}>
                {days.map((d) => {
                  const wx = regional[d.str];
                  return (
                    <div
                      key={d.str}
                      title={wx ? `${wx.label} · ${wx.high}°/${wx.low}° · ${wx.precipChance}% rain` : ""}
                      className={cn(
                        "flex h-5 shrink-0 items-center justify-center gap-0.5 text-[10px] tabular-nums",
                        wx?.wet ? "bg-sky-500/15 text-sky-400" : "text-muted-foreground",
                      )}
                      style={{ width: dayW }}
                    >
                      {wx ? (
                        <>
                          <span aria-hidden>{wx.icon}</span>
                          {dayW >= 40 && <span>{wx.high}°</span>}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <SectionHeading label="On site" count={onsite.length} tone="text-green-500" hint="in construction" />
        {onsite.map(renderJob)}
        {onsite.length === 0 && <EmptyLine text="No on-site job matches." />}

        <SectionHeading label="Starting soon" count={starting.length} tone="text-amber-500" hint="signed, not started" />
        {starting.map(renderJob)}
        {starting.length === 0 && <EmptyLine text="Nothing signed and waiting." />}

        <SectionHeading label="Pipeline" count={pipeline.length} tone="text-blue-400" hint="out for decision — no dates yet" />
        <div className="sticky left-0 flex flex-wrap gap-1.5 px-3 pb-4 pt-1" style={{ width: Math.min(NAME_W + trackW, 1100) }}>
          {pipeline.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => onOpenProject(job.id)}
              className="inline-flex items-center gap-2 rounded border border-border bg-muted/40 px-2.5 py-1 text-xs hover:border-primary/60 hover:text-primary"
            >
              <span className="max-w-[180px] truncate">{job.name}</span>
              {job.contractValue !== null && (
                <span className="tabular-nums text-[10px] text-muted-foreground">{money(job.contractValue)}</span>
              )}
            </button>
          ))}
          {pipeline.length === 0 && <span className="text-xs text-muted-foreground">Nothing out for decision.</span>}
        </div>
      </div>
    </div>
  );
}

// ── Header cell ──────────────────────────────────────────────────

function DayHead({ day, dayW }: { day: BoardDay; dayW: number }) {
  const isMonday = new Date(`${day.str}T12:00:00`).getDay() === 1;
  const num = day.label.split("/")[1];
  return (
    <div
      className={cn(
        "flex h-8 shrink-0 flex-col items-center justify-center leading-none",
        day.isToday
          ? "bg-primary/20 font-semibold text-primary"
          : day.isWeekend
            ? "bg-muted/50 text-muted-foreground/60"
            : "text-muted-foreground",
        isMonday && "border-l border-border",
      )}
      style={{ width: dayW }}
      title={new Date(`${day.str}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
    >
      {dayW >= 30 && <span className="text-[10px]">{day.dayName.slice(0, dayW >= 44 ? 3 : 1)}</span>}
      {(dayW >= 18 || isMonday || day.isToday) && (
        <span className={cn("tabular-nums", dayW >= 30 ? "text-xs font-semibold" : "text-[10px]")}>
          {dayW >= 30 ? day.label : num}
        </span>
      )}
    </div>
  );
}

function SectionHeading({ label, count, tone, hint }: { label: string; count: number; tone: string; hint: string }) {
  return (
    <div className="sticky left-0 z-20 flex w-fit items-center gap-3 bg-card px-3 pb-1 pt-3">
      <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${tone}`}>
        {label} — {count}
      </span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="sticky left-0 w-fit px-3 py-2 text-xs text-muted-foreground">{text}</p>;
}

// ── Row track ────────────────────────────────────────────────────

function Track({
  data,
  job,
  dayW,
  height,
  quiet,
  onDoubleClick,
  children,
}: {
  data: BoardData;
  job: BoardJob;
  dayW: number;
  height: number;
  /** Step rows inside an open job: grid only, no weather tint. */
  quiet?: boolean;
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children?: React.ReactNode;
}) {
  const { days, weather } = data;
  const siteDays = weather[job.site] ?? weather[data.defaultSite] ?? {};
  const todayIdx = days.findIndex((d) => d.isToday);
  return (
    <div
      onDoubleClick={onDoubleClick}
      className="relative shrink-0 border-b border-border/60"
      style={{ width: days.length * dayW, height, ...gridBackground(days, dayW) }}
    >
      {!quiet &&
        days.map((d, i) => {
          const wx = siteDays[d.str];
          if (!wx?.wet || d.isPast) return null;
          return (
            <div
              key={d.str}
              className="pointer-events-none absolute inset-y-0 bg-sky-500/10"
              style={{ left: i * dayW, width: dayW }}
              aria-hidden
            />
          );
        })}
      {todayIdx >= 0 && (
        <div
          className="pointer-events-none absolute inset-y-0 border-x border-primary/60 bg-primary/[0.07]"
          style={{ left: todayIdx * dayW, width: dayW }}
          aria-hidden
        />
      )}
      {children}
    </div>
  );
}

/** Small green marks along the bottom: days someone actually clocked in here. */
function WorkedTicks({ job, days, dayW }: { job: BoardJob; days: BoardDay[]; dayW: number }) {
  if (!job.workedDays.length) return null;
  const idx = new Map(days.map((d, i) => [d.str, i]));
  return (
    <>
      {job.workedDays.map((d) => {
        const i = idx.get(d);
        if (i === undefined) return null;
        return (
          <span
            key={d}
            className="pointer-events-none absolute bottom-[3px] h-[3px] rounded-full bg-emerald-500/80"
            style={{ left: i * dayW + Math.max(2, dayW * 0.2), width: Math.max(4, dayW * 0.6) }}
            title="Crew clocked in"
            aria-hidden
          />
        );
      })}
    </>
  );
}

/** The strip along the top of a job: draws, the finish flag, orders, todos. */
function Band({
  job,
  days,
  dayW,
  onOpen,
}: {
  job: BoardJob;
  days: BoardDay[];
  dayW: number;
  onOpen: () => void;
}) {
  const closeIdx = job.closeDate ? days.findIndex((d) => d.str === job.closeDate) : -1;
  const late = (job.closeSlipDays ?? 0) > 0;
  return (
    <>
      {closeIdx >= 0 && (
        <span
          className={cn(
            "absolute top-[2px] z-10 flex h-3 items-center gap-0.5 whitespace-nowrap rounded px-1 text-[9px] leading-3",
            late ? "bg-red-500/20 text-red-400" : "bg-green-500/15 text-green-400",
          )}
          style={{ left: closeIdx * dayW + 1 }}
          title={
            job.closeSource === "schedule"
              ? `Last work scheduled ${shortDay(job.closeDate!)}${late ? ` — ${job.closeSlipDays} days past the target end` : ""}`
              : `Target finish ${shortDay(job.closeDate!)} (from the estimate)`
          }
        >
          <Flag className="h-2.5 w-2.5 shrink-0" aria-hidden />
          {dayW >= 22 && "finish"}
          {late && dayW >= 22 ? ` +${job.closeSlipDays}d` : ""}
        </span>
      )}
      {job.payments.map((pay) => (
        <PaymentDot key={pay.id} pay={pay} dayW={dayW} onOpen={onOpen} />
      ))}
      {job.markers.map((m) => (
        <button
          key={m.id}
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onOpen}
          title={`${m.kind === "order" ? "Material order" : "To-do"}: ${m.label}${m.overdue ? " — overdue" : ""}`}
          className={cn(
            "absolute top-[2px] z-10 flex h-3 items-center justify-center rounded-sm px-0.5",
            m.overdue ? "bg-red-500/25 text-red-400" : m.kind === "order" ? "bg-amber-500/20 text-amber-500" : "bg-blue-500/20 text-blue-400",
          )}
          style={{ left: (m.col - 1) * dayW + Math.max(0, dayW / 2 - 7), minWidth: 12 }}
        >
          {m.kind === "order" ? <Package className="h-2.5 w-2.5" aria-hidden /> : <Check className="h-2.5 w-2.5" aria-hidden />}
        </button>
      ))}
    </>
  );
}

function PaymentDot({ pay, dayW, onOpen }: { pay: BoardPayment; dayW: number; onOpen: () => void }) {
  if (pay.col === null) return null;
  const tone =
    pay.status === "paid"
      ? "border-green-500/40 bg-green-500/25 text-green-300 opacity-60"
      : pay.status === "invoiced"
        ? "border-amber-500/40 bg-amber-500/25 text-amber-200"
        : "border-emerald-500/40 bg-emerald-600/20 text-emerald-300";
  return (
    <button
      type="button"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onOpen}
      title={[
        pay.label,
        pay.amount !== null ? `$${pay.amount.toLocaleString()}` : null,
        pay.requires.length > 1
          ? `Waits on: ${pay.requires.join(", ")}`
          : pay.anchor
            ? `Earned when "${pay.anchor}" finishes`
            : null,
        pay.status === "paid" ? "PAID" : pay.status === "invoiced" ? "Invoiced — awaiting payment" : "Not invoiced yet",
      ]
        .filter(Boolean)
        .join(" · ")}
      className={cn(
        "absolute top-[1px] z-10 flex h-3.5 items-center gap-0.5 whitespace-nowrap rounded-full border px-1 text-[9px] font-medium leading-3",
        tone,
      )}
      style={{ left: (pay.col - 1) * dayW + 1 }}
    >
      <BadgeDollarSign className="h-2.5 w-2.5 shrink-0" aria-hidden />
      {dayW >= 30 && (pay.amount !== null ? money(pay.amount) : "Draw")}
    </button>
  );
}

// ── Left column ──────────────────────────────────────────────────

function NameCell({
  job,
  health,
  height,
  open,
  hidden,
  conflicts,
  onToggle,
  onOpen,
  onFit,
}: {
  job: BoardJob;
  health: ProjectHealth | undefined;
  height: number;
  open: boolean;
  hidden: number;
  conflicts: number;
  onToggle: () => void;
  onOpen: () => void;
  onFit: () => void;
}) {
  const dot =
    health?.health === "red"
      ? "bg-red-500"
      : health?.health === "yellow"
        ? "bg-amber-500"
        : health?.health === "green"
          ? "bg-green-500"
          : "bg-muted-foreground/30";
  const position = job.received !== null && job.spent !== null ? job.received - job.spent : null;
  const shortNo = job.projectNumber?.replace(/^PC-\d{4}-/, "") ?? "";
  const starting = job.status === "contracted";

  return (
    <div
      className={cn(
        "group/name sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-0.5 border-r border-b border-border bg-card py-1 pl-1 pr-2",
        open && "bg-muted/40",
      )}
      style={{ width: NAME_W, height }}
      title={health ? `${health.note}${health.issues.length ? ` — ${health.issues.join("; ")}` : ""}` : undefined}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? `Close ${job.name}` : `Open every step of ${job.name}`}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
        </button>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-[13px] font-medium hover:text-primary"
        >
          {job.name}
        </button>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{shortNo}</span>
        {position !== null && (job.received !== 0 || job.spent !== 0) && (
          <span
            className={cn("shrink-0 text-[10px] tabular-nums", position < 0 ? "font-medium text-red-400" : "text-green-500/80")}
            title={`Client paid ${money(job.received)} · job spent ${money(job.spent)}${position < 0 ? " — Penney is funding this job" : ""}`}
          >
            {position < 0 ? "−" : "+"}
            {money(position)}
          </span>
        )}
        <button
          type="button"
          onClick={onFit}
          title="Fit the whole job on screen"
          aria-label={`Fit ${job.name} on screen`}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/name:opacity-100"
        >
          <Maximize2 className="h-3 w-3" aria-hidden />
        </button>
      </div>

      {!open && (
        <div className="truncate pl-6 text-[11px] leading-tight text-muted-foreground">
          {starting && job.startsInDays !== null && job.startDate ? (
            <span className="text-amber-500">
              {job.startsInDays <= 0 ? "Starts today" : `Starts in ${job.startsInDays}d`} · {shortDay(job.startDate)}
            </span>
          ) : job.nowStep ? (
            <span className="text-foreground/80">▸ {job.nowStep.name}</span>
          ) : (
            <span>Nothing on today</span>
          )}
          {job.nextStep && (
            <span>
              {" · next "}
              <span className={job.nextStep.confirmed ? "text-foreground/80" : "italic"}>
                {shortDay(job.nextStep.startDate)} {job.nextStep.name}
              </span>
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 pl-6">
        {job.crewToday.length > 0 && (
          <Chip tone="green" title={job.crewToday.map((c) => c.name).join(", ")}>
            <Users className="h-2.5 w-2.5" aria-hidden />
            {job.crewToday.length} on site
          </Chip>
        )}
        {job.status === "in_progress" && job.nothingAhead && (
          <Chip tone="red" title="Nothing on the calendar from today on — book the next step">
            <CalendarOff className="h-2.5 w-2.5" aria-hidden />
            Nothing booked
          </Chip>
        )}
        {job.overdueCount > 0 && (
          <Chip tone="amber" title="Steps whose end date passed and aren't marked done">
            <Clock className="h-2.5 w-2.5" aria-hidden />
            {job.overdueCount} late
          </Chip>
        )}
        {conflicts > 0 && (
          <Chip tone="red" title="Steps scheduled in an order that can't happen — open the job to see which">
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
            {conflicts} out of order
          </Chip>
        )}
        {job.unsignedCoCount > 0 && (
          <Chip tone="red">
            {job.unsignedCoCount} CO{job.unsignedCoCount > 1 ? "s" : ""} open
          </Chip>
        )}
        {hidden > 0 && (
          <button type="button" onClick={onToggle} className="rounded bg-muted px-1 text-[10px] text-muted-foreground hover:text-foreground">
            +{hidden} more
          </button>
        )}
        {starting && job.startsInDays === null && (
          <Chip tone="red">
            <CalendarOff className="h-2.5 w-2.5" aria-hidden />
            No start date
          </Chip>
        )}
      </div>
    </div>
  );
}

function Chip({
  tone,
  title,
  children,
}: {
  tone: "green" | "red" | "amber";
  title?: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? "bg-green-500/15 text-green-500"
      : tone === "red"
        ? "bg-red-500/15 text-red-400"
        : "bg-amber-500/15 text-amber-500";
  return (
    <span title={title} className={`inline-flex items-center gap-0.5 rounded px-1 text-[10px] leading-4 ${cls}`}>
      {children}
    </span>
  );
}

function StepCell({
  bar,
  issues,
  selected,
  onOpen,
}: {
  bar: BoardBar;
  issues: SequenceIssue[] | undefined;
  selected: boolean;
  onOpen: () => void;
}) {
  const people = [...bar.crew, ...bar.subs];
  const conflict = issues?.some((i) => i.severity === "conflict");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-b border-border/60 bg-card pl-7 pr-2 text-left hover:bg-muted",
        selected && "bg-primary/10",
      )}
      style={{ width: NAME_W, height: STEP_H }}
      title={[bar.name, people.length ? people.join(", ") : "Nobody assigned", ...(issues ?? []).map((i) => i.message)].join("\n")}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{
          backgroundColor: bar.kind === "plan" ? bar.color : "transparent",
          border: bar.kind === "plan" ? undefined : `1.5px solid ${bar.color}`,
        }}
        aria-hidden
      />
      <span className={cn("min-w-0 flex-1 truncate text-xs", bar.status === "completed" && "text-muted-foreground line-through")}>
        {bar.name}
      </span>
      {conflict && <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" aria-hidden />}
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {people.length ? people.map(firstName).slice(0, 2).join(", ") + (people.length > 2 ? ` +${people.length - 2}` : "") : ""}
      </span>
    </button>
  );
}

// ── Bar ──────────────────────────────────────────────────────────

function BarView({
  bar,
  dayW,
  top,
  height,
  offset,
  selected,
  dragging,
  issues,
  showPlanned,
  onMouseDown,
}: {
  bar: BoardBar;
  dayW: number;
  top: number;
  height: number;
  /** The dashed "original plan" outline — only on an open job's own line. */
  showPlanned?: boolean;
  offset: { s: number; e: number };
  selected: boolean;
  dragging: boolean;
  issues: SequenceIssue[] | undefined;
  onMouseDown: (e: React.MouseEvent, width: number) => void;
}) {
  const startCol = bar.startCol + offset.s;
  const endCol = bar.endCol + offset.e;
  const people = [...bar.crew, ...bar.subs];
  const conflict = issues?.some((i) => i.severity === "conflict");
  const warning = !conflict && !!issues?.length;
  const done = bar.status === "completed";
  const risk = bar.risks[0];

  const tip = [
    bar.name,
    `${shortDay(bar.startDate)}${bar.endDate !== bar.startDate ? ` → ${shortDay(bar.endDate)}` : ""}`,
    people.length ? people.join(", ") : "Nobody assigned",
    bar.kind === "crew" ? (bar.isConfirmed ? "Crew day — confirmed" : "Crew day — proposed") : null,
    bar.kind === "sub" ? "Proposed by the sub" : null,
    bar.kind === "plan" && bar.isConfirmed ? "Confirmed — the crew on it are emailed if it moves" : null,
    bar.slipDays ? `${bar.slipDays} days off plan` : null,
    risk ? `Weather: ${risk.reason}` : null,
    ...(issues ?? []).map((i) => i.message),
  ]
    .filter(Boolean)
    .join("\n");

  if (bar.isMilestone) {
    const left = (startCol - 1) * dayW;
    return (
      <div
        role="button"
        tabIndex={0}
        onMouseDown={(e) => onMouseDown(e, dayW)}
        title={tip}
        className={cn(
          "absolute z-10 flex cursor-grab items-center gap-1 whitespace-nowrap text-[11px] font-medium",
          selected && "rounded ring-2 ring-primary",
          dragging && "z-30",
        )}
        style={{ left: left + Math.max(0, dayW / 2 - height / 2), top, height }}
      >
        <span
          className="block shrink-0 rotate-45 rounded-[2px] border border-black/30"
          style={{ width: height * 0.7, height: height * 0.7, backgroundColor: bar.color }}
          aria-hidden
        />
        <span className={cn("max-w-[160px] truncate", done ? "text-muted-foreground line-through" : "text-foreground")}>
          {bar.name}
        </span>
      </div>
    );
  }

  const left = (startCol - 1) * dayW + 1;
  const width = Math.max(4, (endCol - startCol + 1) * dayW - 2);
  const showText = width >= 34;
  const crewish = bar.kind !== "plan";

  return (
    <>
      {showPlanned && bar.planned && !dragging && bar.kind === "plan" && (
        <div
          className="pointer-events-none absolute rounded-sm border border-dashed border-muted-foreground/50"
          style={{
            left: (bar.planned.startCol - 1) * dayW + 1,
            width: (bar.planned.endCol - bar.planned.startCol + 1) * dayW - 2,
            top: top + 2,
            height: height - 4,
          }}
          aria-hidden
        />
      )}
      <div
        role="button"
        tabIndex={0}
        onMouseDown={(e) => onMouseDown(e, width)}
        title={tip}
        className={cn(
          "group absolute flex items-center gap-1 overflow-hidden rounded-[4px] px-1.5 text-left text-[11px] font-medium leading-none",
          crewish ? "text-foreground" : "text-black/85",
          done && "opacity-45",
          dragging ? "z-30 shadow-lg ring-2 ring-primary" : "z-10 hover:brightness-110",
          selected && !dragging && "ring-2 ring-primary ring-offset-1 ring-offset-card",
          conflict && !selected && "ring-2 ring-red-500",
          warning && !selected && "ring-1 ring-amber-400",
        )}
        style={{
          left,
          width,
          top,
          height,
          cursor: "grab",
          backgroundColor: crewish ? `${bar.color}33` : bar.color,
          borderLeft: crewish ? `3px solid ${bar.color}` : undefined,
          outline: !bar.isConfirmed && crewish ? `1px dashed ${bar.color}` : undefined,
          outlineOffset: -1,
          backgroundImage:
            bar.kind === "plan" && !bar.isConfirmed
              ? "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.18) 0 4px, transparent 4px 8px)"
              : undefined,
        }}
      >
        {width > EDGE * 3 && !bar.clippedStart && (
          <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize group-hover:bg-black/25" aria-hidden />
        )}
        {width > EDGE * 3 && !bar.clippedEnd && (
          <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize group-hover:bg-black/25" aria-hidden />
        )}
        {done && <Check className="h-3 w-3 shrink-0" aria-hidden />}
        {risk && !done && <CloudRain className="h-3 w-3 shrink-0" aria-hidden />}
        {showText && <span className="truncate">{bar.name}</span>}
        {showText && people.length > 0 && width >= 90 && (
          <span className="ml-auto flex shrink-0 gap-0.5">
            {people.slice(0, 3).map((p) => (
              <span key={p} className="rounded bg-black/20 px-1 text-[9px] leading-[13px]" title={p}>
                {initials(p)}
              </span>
            ))}
            {people.length > 3 && <span className="text-[9px]">+{people.length - 3}</span>}
          </span>
        )}
      </div>
    </>
  );
}
