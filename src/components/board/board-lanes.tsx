"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarOff, CloudRain, Flag, Package, Users } from "lucide-react";
import type { BoardData, BoardJob, BoardBar, BoardDay } from "@/lib/board/board-data";
import type { ProjectHealth } from "./job-board";

/**
 * Direction A — the lanes board.
 *
 * ON SITE gets the day grid. STARTING SOON gets a countdown instead of
 * columns, because a contracted job's only date that matters is its first
 * one. PIPELINE gets pills, because those jobs have no dates at all and
 * giving them 68 empty day-columns is what made the old board unreadable.
 *
 * Bars are draggable: grab the middle to move the phase, grab an edge to
 * stretch it. Everything snaps to whole days.
 */

const NAME_W = 232;

/** Column widths behind the size control. */
export const COL_SIZES = { compact: 104, comfortable: 148, large: 200 } as const;
export type BoardSize = keyof typeof COL_SIZES;

/**
 * Milestone strip along the top of every row. Finish flags live here and
 * nowhere else, so they can never land on top of a phase bar.
 */
const BAND_H = 18;
const ROW_PAD = BAND_H + 5;
const BAR_H = 28;
const BAR_GAP = 4;
/** Grab zone at each end of a bar for resizing. */
const EDGE = 10;
/** Pixels of travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 6;

interface Props {
  data: BoardData;
  health: Map<string, ProjectHealth>;
  colW: number;
  onOpenProject: (projectId: string) => void;
  onOpenPhase: (bar: BoardBar) => void;
  onMovePhase: (bar: BoardBar, startDate: string, endDate: string) => void;
}

type DragMode = "move" | "start" | "end";

interface DragState {
  bar: BoardBar;
  mode: DragMode;
  originX: number;
  deltaStart: number;
  deltaEnd: number;
  moved: boolean;
}

// ── Bar stacking ─────────────────────────────────────────────────

/**
 * Greedy interval packing: each bar drops into the first sub-row it doesn't
 * collide with. Two phases running the same week stack instead of overlapping,
 * and a row is only as tall as its busiest stretch demands.
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

function money(n: number | null) {
  if (n === null) return null;
  return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`;
}

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function trackBackground(days: BoardDay[], colW: number) {
  const firstDow = new Date(`${days[0].str}T00:00:00`).getDay();
  const satOffset = (6 - firstDow + 7) % 7;
  return {
    backgroundImage: [
      `repeating-linear-gradient(to right, transparent 0 ${colW - 1}px, var(--border) ${colW - 1}px ${colW}px)`,
      `repeating-linear-gradient(to right, rgb(120 120 120 / 0.07) 0 ${2 * colW}px, transparent ${2 * colW}px ${7 * colW}px)`,
    ].join(","),
    backgroundPosition: `0 0, ${satOffset * colW}px 0`,
  };
}

export function BoardLanes({
  data,
  health,
  colW,
  onOpenProject,
  onOpenPhase,
  onMovePhase,
}: Props) {
  const { days, onsite, starting, pipeline } = data;
  const scrollRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);

  const trackWidth = days.length * colW;
  const todayIdx = useMemo(() => days.findIndex((d) => d.isToday), [days]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && todayIdx >= 0) el.scrollLeft = Math.max(0, todayIdx * colW - 40);
    // Re-centre on today whenever the zoom changes, or the view jumps.
  }, [todayIdx, colW]);

  // ── Bar drag ───────────────────────────────────────────────────

  /**
   * Listeners are attached SYNCHRONOUSLY here, inside the mousedown handler —
   * not from an effect. An effect runs after paint, so a quick click released
   * before that frame never saw its own mouseup: the bar refused to open and
   * the drag state stayed latched, which then swallowed every later click too.
   */
  const beginDrag = useCallback(
    (bar: BoardBar, mode: DragMode, clientX: number) => {
      releaseRef.current?.();

      const state: DragState = {
        bar,
        mode,
        originX: clientX,
        deltaStart: 0,
        deltaEnd: 0,
        moved: false,
      };
      dragRef.current = state;
      setDrag(state);

      const onMove = (e: MouseEvent) => {
        const current = dragRef.current;
        if (!current) return;
        const dx = e.clientX - current.originX;
        // A drag has to be deliberate. Under the threshold this stays a click,
        // so a twitchy hand can never reschedule a crew by accident.
        if (!current.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
        const steps = Math.round(dx / colW);
        let deltaStart = 0;
        let deltaEnd = 0;
        if (current.mode === "move") {
          deltaStart = steps;
          deltaEnd = steps;
        } else if (current.mode === "start") {
          deltaStart = Math.min(steps, current.bar.endCol - current.bar.startCol);
        } else {
          deltaEnd = Math.max(steps, current.bar.startCol - current.bar.endCol);
        }
        if (
          current.moved &&
          deltaStart === current.deltaStart &&
          deltaEnd === current.deltaEnd
        ) {
          return;
        }
        const next = { ...current, deltaStart, deltaEnd, moved: true };
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
        const current = dragRef.current;
        release();
        if (!current) return;
        if (!current.moved || (current.deltaStart === 0 && current.deltaEnd === 0)) {
          onOpenPhase(current.bar);
          return;
        }
        const startCol = clampCol(current.bar.startCol + current.deltaStart, days.length);
        const endCol = clampCol(current.bar.endCol + current.deltaEnd, days.length);
        onMovePhase(current.bar, days[startCol - 1].str, days[endCol - 1].str);
      };

      releaseRef.current = release;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      // Losing the window mid-drag must not leave the board latched.
      window.addEventListener("blur", release);
    },
    [colW, days, onMovePhase, onOpenPhase],
  );

  // Never leave listeners behind on unmount.
  useEffect(() => () => releaseRef.current?.(), []);

  // ── Container pan (only when the grab didn't start on a bar) ────

  const onMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || e.button !== 0 || drag) return;
    pan.current = { startX: e.clientX, startLeft: el.scrollLeft, moved: false };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || !pan.current || drag) return;
    const dx = e.clientX - pan.current.startX;
    if (Math.abs(dx) > 3) pan.current.moved = true;
    el.scrollLeft = pan.current.startLeft - dx;
  };
  const endPan = () => {
    pan.current = null;
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (pan.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const regional = data.weather[data.defaultSite] ?? {};

  return (
    <div
      ref={scrollRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endPan}
      onMouseLeave={endPan}
      onClickCapture={onClickCapture}
      className={`min-h-0 flex-1 select-none overflow-auto overscroll-x-contain rounded-lg border border-border bg-card ${
        drag ? "cursor-grabbing" : ""
      }`}
    >
      <div style={{ width: NAME_W + trackWidth }}>
        {/* ── Header: months, days, regional weather ── */}
        <div className="sticky top-0 z-30 bg-card">
          <div className="flex">
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-b border-border bg-card px-3 py-1.5"
              style={{ width: NAME_W }}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Job
              </span>
            </div>
            <div className="relative shrink-0 border-b border-border" style={{ width: trackWidth }}>
              {days.map((d, i) =>
                d.monthLabel ? (
                  <span
                    key={d.str}
                    className="absolute top-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                    style={{ left: i * colW + 6 }}
                  >
                    {d.monthLabel}
                  </span>
                ) : null,
              )}
            </div>
          </div>

          <div className="flex">
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-b border-border bg-card"
              style={{ width: NAME_W }}
            />
            <div className="flex shrink-0 border-b border-border" style={{ width: trackWidth }}>
              {days.map((d) => (
                <div
                  key={d.str}
                  className={`shrink-0 border-r border-border/60 px-1 py-1 text-center ${
                    d.isToday
                      ? "bg-primary/15 text-primary"
                      : d.isWeekend
                        ? "bg-muted/50 text-muted-foreground/60"
                        : "text-muted-foreground"
                  }`}
                  style={{ width: colW }}
                >
                  <span className="block text-[11px] leading-tight">{d.dayName}</span>
                  <span className="block text-sm font-semibold tabular-nums leading-tight">
                    {d.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-b border-border bg-card px-3 py-1"
              style={{ width: NAME_W }}
            >
              <CloudRain className="h-3 w-3 text-muted-foreground" aria-hidden />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                North Shore
              </span>
            </div>
            <div className="flex shrink-0 border-b border-border" style={{ width: trackWidth }}>
              {days.map((d) => {
                const wx = regional[d.str];
                return (
                  <div
                    key={d.str}
                    title={wx ? `${wx.label} · ${wx.high}°/${wx.low}° · ${wx.precipChance}% rain` : ""}
                    className={`shrink-0 border-r border-border/60 px-1 py-0.5 text-center ${
                      wx?.wet ? "bg-sky-500/15" : d.isToday ? "bg-primary/10" : ""
                    }`}
                    style={{ width: colW }}
                  >
                    {wx ? (
                      <>
                        <span className="block text-sm leading-tight">{wx.icon}</span>
                        <span
                          className={`block text-[11px] tabular-nums leading-tight ${
                            wx.wet ? "text-sky-400" : "text-muted-foreground"
                          }`}
                        >
                          {wx.high}°/{wx.low}°
                        </span>
                      </>
                    ) : (
                      <span className="block py-2 text-[10px] text-muted-foreground/30">·</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── ON SITE ── */}
        <LaneHeading label="On site" count={onsite.length} tone="text-green-500" hint="in construction" />
        {onsite.map((job) => {
          const packed = packBars(job.bars);
          const laneCount = Math.max(1, ...packed.map((p) => p.lane + 1));
          const height = Math.max(72, ROW_PAD + 8 + laneCount * (BAR_H + BAR_GAP));
          return (
            <div key={job.id} className="flex">
              <NameCell job={job} health={health.get(job.id)} onOpen={onOpenProject}>
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  {job.crewToday.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-1.5 py-px text-[10px] text-green-400">
                      <Users className="h-2.5 w-2.5" aria-hidden />
                      {job.crewToday.length} on site
                    </span>
                  )}
                  {job.unscheduled && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-px text-[10px] text-amber-500">
                      <CalendarOff className="h-2.5 w-2.5" aria-hidden />
                      Not scheduled
                    </span>
                  )}
                  {job.unsignedCoCount > 0 && (
                    <span className="rounded bg-red-500/15 px-1.5 py-px text-[10px] text-red-400">
                      {job.unsignedCoCount} CO{job.unsignedCoCount > 1 ? "s" : ""} open
                    </span>
                  )}
                </span>
              </NameCell>
              <Track data={data} job={job} height={height} colW={colW}>
                {packed.map(({ bar, lane }) => (
                  <BarView
                    key={bar.id}
                    bar={bar}
                    lane={lane}
                    colW={colW}
                    drag={drag?.bar.id === bar.id ? drag : null}
                    onBeginDrag={beginDrag}
                  />
                ))}
                {job.markers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onOpenProject(job.id)}
                    title={m.label}
                    className={`absolute flex items-center gap-1 truncate rounded px-1.5 text-[11px] leading-[20px] ${
                      m.overdue
                        ? "bg-red-500/20 text-red-400"
                        : m.kind === "order"
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-blue-500/15 text-blue-400"
                    }`}
                    style={{
                      left: (m.col - 1) * colW + 3,
                      width: colW - 6,
                      bottom: 3,
                      height: 20,
                    }}
                  >
                    {m.kind === "order" && <Package className="h-3 w-3 shrink-0" aria-hidden />}
                    <span className="truncate">{m.label}</span>
                  </button>
                ))}
                {job.closeDate && <CloseFlag job={job} days={days} colW={colW} />}
              </Track>
            </div>
          );
        })}

        {/* ── STARTING SOON ── */}
        <LaneHeading
          label="Starting soon"
          count={starting.length}
          tone="text-amber-500"
          hint="contracted, not started"
        />
        {starting.map((job) => (
          <div key={job.id} className="flex">
            <NameCell job={job} health={health.get(job.id)} onOpen={onOpenProject} />
            <Track data={data} job={job} height={52} colW={colW}>
              <div className="absolute inset-y-0 left-0 flex items-center gap-2 px-3">
                {job.startsInDays !== null && job.startDate ? (
                  <>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        job.startsInDays <= 7
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {job.startsInDays <= 0
                        ? "Starts today"
                        : `Starts in ${job.startsInDays} day${job.startsInDays === 1 ? "" : "s"}`}
                    </span>
                    <span className="text-xs text-muted-foreground">{shortDate(job.startDate)}</span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                    <CalendarOff className="h-3 w-3" aria-hidden />
                    No start date set
                  </span>
                )}
                {job.contractValue !== null && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {money(job.contractValue)}
                  </span>
                )}
              </div>
            </Track>
          </div>
        ))}

        {/* ── PIPELINE ── */}
        <LaneHeading
          label="Pipeline"
          count={pipeline.length}
          tone="text-blue-400"
          hint="out for decision — no dates yet"
        />
        <div className="sticky left-0 flex flex-wrap gap-1.5 px-3 py-2" style={{ width: NAME_W + 720 }}>
          {pipeline.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => onOpenProject(job.id)}
              className="inline-flex items-center gap-2 rounded border border-border bg-muted/40 px-2.5 py-1.5 text-xs hover:border-primary/60 hover:text-primary"
            >
              <span className="max-w-[168px] truncate">{job.name}</span>
              {job.contractValue !== null && (
                <span className="tabular-nums text-[10px] text-muted-foreground">
                  {money(job.contractValue)}
                </span>
              )}
            </button>
          ))}
          {pipeline.length === 0 && (
            <span className="text-xs text-muted-foreground">Nothing out for decision.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function clampCol(col: number, total: number) {
  return Math.max(1, Math.min(total, col));
}

// ── Row track ────────────────────────────────────────────────────

function Track({
  data,
  job,
  height,
  colW,
  children,
}: {
  data: BoardData;
  job: BoardJob;
  height: number;
  colW: number;
  children?: React.ReactNode;
}) {
  const { days, weather } = data;
  const siteDays = weather[job.site] ?? weather[data.defaultSite] ?? {};
  const todayIdx = days.findIndex((d) => d.isToday);

  return (
    <div
      className="relative shrink-0 border-b border-border/60"
      style={{ width: days.length * colW, height, ...trackBackground(days, colW) }}
    >
      {days.map((d, i) => {
        const wx = siteDays[d.str];
        if (!wx?.wet || d.isPast) return null;
        return (
          <div
            key={d.str}
            className="absolute top-0 bottom-0 bg-sky-500/10"
            style={{ left: i * colW, width: colW }}
            aria-hidden
          />
        );
      })}
      {todayIdx >= 0 && (
        <div
          className="absolute top-0 bottom-0 border-x border-primary/70 bg-primary/[0.07]"
          style={{ left: todayIdx * colW, width: colW }}
          aria-hidden
        />
      )}
      {children}
    </div>
  );
}

// ── Name cell ────────────────────────────────────────────────────

function NameCell({
  job,
  health,
  onOpen,
  children,
}: {
  job: BoardJob;
  health: ProjectHealth | undefined;
  onOpen: (id: string) => void;
  children?: React.ReactNode;
}) {
  const dot =
    health?.health === "red"
      ? "bg-red-500"
      : health?.health === "yellow"
        ? "bg-amber-500"
        : health?.health === "green"
          ? "bg-green-500"
          : "bg-muted-foreground/30";

  return (
    <div
      className="sticky left-0 z-20 shrink-0 border-r border-b border-border bg-card px-3 py-2"
      style={{ width: NAME_W }}
    >
      <button
        type="button"
        onClick={() => onOpen(job.id)}
        className="group flex w-full items-start gap-2 text-left"
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:text-primary">
            {job.name}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{job.projectNumber}</span>
            {job.city && <span className="truncate">· {job.city}</span>}
          </span>
          {children}
        </span>
      </button>
    </div>
  );
}

function LaneHeading({
  label,
  count,
  tone,
  hint,
}: {
  label: string;
  count: number;
  tone: string;
  hint?: string;
}) {
  return (
    <div className="sticky left-0 z-20 flex items-center gap-3 bg-card px-3 pt-4 pb-1.5">
      <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${tone}`}>
        {label} — {count}
      </span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

// ── Bar ──────────────────────────────────────────────────────────

function BarView({
  bar,
  lane,
  colW,
  drag,
  onBeginDrag,
}: {
  bar: BoardBar;
  lane: number;
  colW: number;
  drag: DragState | null;
  onBeginDrag: (bar: BoardBar, mode: DragMode, clientX: number) => void;
}) {
  const startCol = bar.startCol + (drag?.deltaStart ?? 0);
  const endCol = bar.endCol + (drag?.deltaEnd ?? 0);
  const left = (startCol - 1) * colW + 3;
  const width = (endCol - startCol + 1) * colW - 6;
  const top = ROW_PAD + lane * (BAR_H + BAR_GAP);
  const risk = bar.risks[0];
  const assigned = bar.crew.length + bar.subs.length;

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Keep the grab off the container, or the board pans instead of the bar.
    e.stopPropagation();
    e.preventDefault();
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const mode: DragMode =
      width > EDGE * 3 && x < EDGE ? "start" : width > EDGE * 3 && x > width - EDGE ? "end" : "move";
    onBeginDrag(bar, mode, e.clientX);
  };

  return (
    <>
      {bar.planned && (
        <div
          className="absolute rounded-sm border border-dashed border-muted-foreground/50"
          style={{
            left: (bar.planned.startCol - 1) * colW + 3,
            width: (bar.planned.endCol - bar.planned.startCol + 1) * colW - 6,
            top: top + 3,
            height: BAR_H - 6,
          }}
          title={`Planned${bar.slipDays ? ` · ${bar.slipDays} days late` : ""}`}
          aria-hidden
        />
      )}
      <div
        role="button"
        tabIndex={0}
        onMouseDown={onMouseDown}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onBeginDrag(bar, "move", 0);
          }
        }}
        title={[
          bar.name,
          assigned ? [...bar.crew, ...bar.subs].join(", ") : "Nobody assigned",
          bar.slipDays ? `${bar.slipDays} days off plan` : null,
          risk ? `At risk: ${risk.reason}` : null,
          "Drag to move · drag an edge to stretch",
        ]
          .filter(Boolean)
          .join(" · ")}
        className={`group absolute flex items-center gap-1.5 overflow-hidden rounded-sm px-2 text-left text-xs font-medium text-black/85 ${
          drag ? "z-20 ring-2 ring-primary" : "hover:brightness-110"
        } ${bar.isConfirmed ? "" : "opacity-85"}`}
        style={{
          left,
          width,
          top,
          height: BAR_H,
          backgroundColor: bar.color,
          cursor: drag?.mode === "start" || drag?.mode === "end" ? "ew-resize" : "grab",
        }}
      >
        {/* Resize handles — visible on hover so the affordance is discoverable. */}
        {width > EDGE * 3 && (
          <>
            <span
              className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize bg-black/0 group-hover:bg-black/20"
              aria-hidden
            />
            <span
              className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize bg-black/0 group-hover:bg-black/20"
              aria-hidden
            />
          </>
        )}
        {risk && <CloudRain className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        {!!bar.slipDays && bar.slipDays > 0 && (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        <span className="truncate">{bar.name}</span>
        {assigned > 0 ? (
          <span className="ml-auto shrink-0 rounded bg-black/20 px-1 text-[10px]">
            {[...bar.crew, ...bar.subs][0]?.split(" ")[0]}
            {assigned > 1 ? ` +${assigned - 1}` : ""}
          </span>
        ) : (
          <span className="ml-auto shrink-0 rounded bg-black/25 px-1 text-[10px] opacity-70">
            unassigned
          </span>
        )}
      </div>
    </>
  );
}

// ── Projected finish flag ────────────────────────────────────────

function CloseFlag({ job, days, colW }: { job: BoardJob; days: BoardDay[]; colW: number }) {
  const idx = days.findIndex((d) => d.str === job.closeDate);
  if (idx < 0) return null;
  const late = (job.closeSlipDays ?? 0) > 0;
  return (
    <div
      className={`absolute flex items-center gap-1 whitespace-nowrap rounded px-1.5 text-[10px] leading-4 ${
        late ? "bg-red-500/20 text-red-400" : "bg-green-500/15 text-green-400"
      }`}
      style={{ left: idx * colW + 3, top: 2, height: BAND_H - 4 }}
      title={
        job.closeSource === "schedule"
          ? `Last work scheduled on this job${late ? ` — ${job.closeSlipDays} days past the target end date` : ""}`
          : "Target finish from the estimate"
      }
    >
      <Flag className="h-2.5 w-2.5 shrink-0" aria-hidden />
      Last work {shortDate(job.closeDate!)}
      {late ? ` · +${job.closeSlipDays}d` : ""}
    </div>
  );
}
