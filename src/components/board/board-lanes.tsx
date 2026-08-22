"use client";

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, CalendarOff, CloudRain, Package, Flag, Users } from "lucide-react";
import type { BoardData, BoardJob, BoardBar, BoardDay } from "@/lib/board/board-data";
import type { ProjectHealth } from "./job-board";

/**
 * Direction A — the lanes board.
 *
 * ON SITE gets the day grid. STARTING SOON gets a countdown instead of
 * columns, because a contracted job's only date that matters is its first
 * one. PIPELINE gets pills, because those jobs have no dates at all and
 * giving them 68 empty day-columns is what made the old board unreadable.
 */

const NAME_W = 232;
export const COL_W = 96;

const ROW_PAD = 8;
const BAR_H = 20;
const BAR_GAP = 3;

interface Props {
  data: BoardData;
  health: Map<string, ProjectHealth>;
  onOpen: (projectId: string) => void;
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
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Shared column background ─────────────────────────────────────

/**
 * Gridlines and weekend shading as two repeating gradients rather than
 * 68 divs per row. The weekend band is a 7-day period shifted so it lands on
 * the window's actual Saturday.
 */
function trackBackground(days: BoardDay[]) {
  const firstDow = new Date(`${days[0].str}T00:00:00`).getDay();
  const satOffset = (6 - firstDow + 7) % 7;
  return {
    backgroundImage: [
      `repeating-linear-gradient(to right, transparent 0 ${COL_W - 1}px, var(--border) ${COL_W - 1}px ${COL_W}px)`,
      `repeating-linear-gradient(to right, rgb(120 120 120 / 0.07) 0 ${2 * COL_W}px, transparent ${2 * COL_W}px ${7 * COL_W}px)`,
    ].join(","),
    backgroundPosition: `0 0, ${satOffset * COL_W}px 0`,
  };
}

// ── Row track ────────────────────────────────────────────────────

function Track({
  data,
  job,
  height,
  children,
}: {
  data: BoardData;
  job: BoardJob;
  height: number;
  children?: React.ReactNode;
}) {
  const { days, weather } = data;
  // Wet days come from THIS job's own forecast — Gloucester and Danvers
  // genuinely differ, and the row tint is the job's own sky.
  const siteDays = weather[job.site] ?? weather[data.defaultSite] ?? {};
  const todayIdx = days.findIndex((d) => d.isToday);

  return (
    <div
      className="relative shrink-0 border-b border-border/60"
      style={{ width: days.length * COL_W, height, ...trackBackground(days) }}
    >
      {days.map((d, i) => {
        const wx = siteDays[d.str];
        if (!wx?.wet || d.isPast) return null;
        return (
          <div
            key={d.str}
            className="absolute top-0 bottom-0 bg-sky-500/10"
            style={{ left: i * COL_W, width: COL_W }}
            aria-hidden
          />
        );
      })}
      {todayIdx >= 0 && (
        <div
          className="absolute top-0 bottom-0 border-x border-primary/70 bg-primary/[0.07]"
          style={{ left: todayIdx * COL_W, width: COL_W }}
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

// ── Lane heading ─────────────────────────────────────────────────

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
      <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${tone}`}>
        {label} — {count}
      </span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

// ── Lanes ────────────────────────────────────────────────────────

export function BoardLanes({ data, health, onOpen }: Props) {
  const { days, onsite, starting, pipeline } = data;
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);

  const trackWidth = days.length * COL_W;
  const todayIdx = useMemo(() => days.findIndex((d) => d.isToday), [days]);

  // Land with today just right of the sticky name column.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && todayIdx >= 0) el.scrollLeft = Math.max(0, todayIdx * COL_W - 40);
  }, [todayIdx]);

  const onMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || e.button !== 0) return;
    drag.current = { startX: e.clientX, startLeft: el.scrollLeft, moved: false };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || !drag.current) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 3) drag.current.moved = true;
    el.scrollLeft = drag.current.startLeft - dx;
  };
  const endDrag = () => {
    drag.current = null;
  };
  // A drag across the grid must not count as a click on whatever ended up
  // under the cursor.
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current?.moved) {
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
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onClickCapture={onClickCapture}
      className="min-h-0 flex-1 select-none overflow-auto overscroll-x-contain rounded-lg border border-border bg-card"
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
                    style={{ left: i * COL_W + 6 }}
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
                  style={{ width: COL_W }}
                >
                  <span className="block text-[10px] leading-tight">{d.dayName}</span>
                  <span className="block text-xs font-semibold tabular-nums leading-tight">
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
                    style={{ width: COL_W }}
                  >
                    {wx ? (
                      <>
                        <span className="block text-xs leading-tight">{wx.icon}</span>
                        <span
                          className={`block text-[10px] tabular-nums leading-tight ${
                            wx.wet ? "text-sky-400" : "text-muted-foreground"
                          }`}
                        >
                          {wx.high}°/{wx.low}°
                        </span>
                      </>
                    ) : (
                      // Past the forecast horizon. Blank beats a guess.
                      <span className="block py-1.5 text-[10px] text-muted-foreground/30">·</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── ON SITE ── */}
        <LaneHeading
          label="On site"
          count={onsite.length}
          tone="text-green-500"
          hint="in construction"
        />
        {onsite.map((job) => {
          const packed = packBars(job.bars);
          const laneCount = Math.max(1, ...packed.map((p) => p.lane + 1));
          const height = Math.max(52, ROW_PAD * 2 + laneCount * (BAR_H + BAR_GAP));
          return (
            <div key={job.id} className="flex">
              <NameCell job={job} health={health.get(job.id)} onOpen={onOpen}>
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
              <Track data={data} job={job} height={height}>
                {packed.map(({ bar, lane }) => (
                  <BarView
                    key={bar.id}
                    bar={bar}
                    lane={lane}
                    onOpen={() => onOpen(job.id)}
                  />
                ))}
                {job.markers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onOpen(job.id)}
                    title={m.label}
                    className={`absolute flex items-center gap-1 truncate rounded px-1.5 text-[10px] leading-[18px] ${
                      m.overdue
                        ? "bg-red-500/20 text-red-400"
                        : m.kind === "order"
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-blue-500/15 text-blue-400"
                    }`}
                    style={{
                      left: (m.col - 1) * COL_W + 3,
                      width: COL_W - 6,
                      bottom: 3,
                      height: 18,
                    }}
                  >
                    {m.kind === "order" && <Package className="h-2.5 w-2.5 shrink-0" aria-hidden />}
                    <span className="truncate">{m.label}</span>
                  </button>
                ))}
                {job.closeDate && (
                  <CloseFlag job={job} days={days} />
                )}
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
            <NameCell job={job} health={health.get(job.id)} onOpen={onOpen} />
            <Track data={data} job={job} height={44}>
              <div className="absolute inset-y-0 left-0 flex items-center gap-2 px-3">
                {job.startsInDays !== null && job.startDate ? (
                  <>
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        job.startsInDays <= 7
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {job.startsInDays <= 0
                        ? "Starts today"
                        : `Starts in ${job.startsInDays} day${job.startsInDays === 1 ? "" : "s"}`}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {shortDate(job.startDate)}
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-[11px] text-red-400">
                    <CalendarOff className="h-3 w-3" aria-hidden />
                    No start date set
                  </span>
                )}
                {job.contractValue !== null && (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {money(job.contractValue)}
                  </span>
                )}
                {job.unsignedCoCount > 0 && (
                  <span className="rounded bg-red-500/15 px-1.5 py-px text-[10px] text-red-400">
                    Contract or CO unsigned
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
              onClick={() => onOpen(job.id)}
              className="inline-flex items-center gap-2 rounded border border-border bg-muted/40 px-2.5 py-1 text-xs hover:border-primary/60 hover:text-primary"
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

// ── Bar ──────────────────────────────────────────────────────────

function BarView({
  bar,
  lane,
  onOpen,
}: {
  bar: BoardBar;
  lane: number;
  onOpen: () => void;
}) {
  const left = (bar.startCol - 1) * COL_W + 3;
  const width = (bar.endCol - bar.startCol + 1) * COL_W - 6;
  const top = ROW_PAD + lane * (BAR_H + BAR_GAP);
  const risk = bar.risks[0];

  return (
    <>
      {/* Planned span, when the live dates have drifted off it. */}
      {bar.planned && (
        <div
          className="absolute rounded-sm border border-dashed border-muted-foreground/50"
          style={{
            left: (bar.planned.startCol - 1) * COL_W + 3,
            width: (bar.planned.endCol - bar.planned.startCol + 1) * COL_W - 6,
            top: top + 2,
            height: BAR_H - 4,
          }}
          title={`Planned${bar.slipDays ? ` · ${bar.slipDays} days late` : ""}`}
          aria-hidden
        />
      )}
      <button
        type="button"
        onClick={onOpen}
        title={[
          bar.name,
          bar.crew.length ? bar.crew.join(", ") : null,
          bar.slipDays ? `${bar.slipDays} days off plan` : null,
          risk ? `At risk: ${risk.reason}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        className={`absolute flex items-center gap-1 overflow-hidden px-2 text-left text-[11px] font-medium leading-none text-black/85 hover:brightness-110 ${
          bar.clippedStart ? "rounded-r-sm" : "rounded-l-sm"
        } ${bar.clippedEnd ? "rounded-l-sm" : "rounded-r-sm"} ${
          bar.isConfirmed ? "" : "opacity-85"
        }`}
        style={{ left, width, top, height: BAR_H, backgroundColor: bar.color }}
      >
        {risk && <CloudRain className="h-3 w-3 shrink-0" aria-hidden />}
        {!!bar.slipDays && bar.slipDays > 0 && (
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
        )}
        <span className="truncate">{bar.name}</span>
        {bar.crew.length > 0 && (
          <span className="ml-auto shrink-0 text-[10px] opacity-75">
            {bar.crew.length}
          </span>
        )}
      </button>
    </>
  );
}

// ── Projected finish flag ────────────────────────────────────────

function CloseFlag({ job, days }: { job: BoardJob; days: BoardDay[] }) {
  const idx = days.findIndex((d) => d.str === job.closeDate);
  if (idx < 0) return null; // Finishes outside the window — nothing to draw.
  const late = (job.closeSlipDays ?? 0) > 0;
  return (
    <div
      className={`absolute top-1 flex items-center gap-1 rounded px-1.5 py-px text-[10px] ${
        late ? "bg-red-500/20 text-red-400" : "bg-green-500/15 text-green-400"
      }`}
      style={{ left: idx * COL_W + 3 }}
      title={
        job.closeSource === "schedule"
          ? `Projected finish from the schedule${late ? ` — ${job.closeSlipDays} days past target` : ""}`
          : "Target finish from the estimate"
      }
    >
      <Flag className="h-2.5 w-2.5" aria-hidden />
      {late ? `+${job.closeSlipDays}d` : "Finish"}
    </div>
  );
}
