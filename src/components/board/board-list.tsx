"use client";

import { ChevronRight, GanttChartSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BoardBar, BoardJob, BoardStatus } from "@/lib/board/board-data";
import { isSiteWork } from "@/lib/board/step-kind";
import { scheduleStartLabel } from "@/lib/schedule/health";
import { fmtStamp } from "./board-update-sheet";

/**
 * The Jobs view: one card per job. A card says who runs it, what's on now,
 * what's next, and draws this week and next as a small Gantt — then one
 * status and one button. It works the same on a phone.
 *
 * The job's name and "Full schedule" open that one job's whole schedule on
 * its own screen. The all-jobs Gantt (drag to move) is the other half of the
 * Jobs toggle.
 */

export const STATUS_LABEL: Record<BoardStatus, string> = {
  ok: "Up to date",
  update: "Needs update",
  noplan: "No plan ahead",
};

export const STATUS_PILL: Record<BoardStatus, string> = {
  ok: "bg-green-500/15 text-green-600 dark:text-green-400",
  update: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  noplan: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export const STATUS_DOT: Record<BoardStatus, string> = {
  ok: "bg-green-500",
  update: "bg-amber-500",
  noplan: "bg-red-500",
};

const RANK: Record<BoardStatus, number> = { noplan: 0, update: 1, ok: 2 };

/** Days drawn on a card: this week and next, Monday first. */
const STRIP_DAYS = 14;
const LANE_H = 22;
const MAX_LANES = 4;

interface StripDay {
  str: string;
  dow: number;
}

function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function stripDays(todayStr: string): StripDay[] {
  const today = new Date(`${todayStr}T12:00:00`);
  const back = (today.getDay() + 6) % 7;
  return Array.from({ length: STRIP_DAYS }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - back + i);
    return { str: iso(d), dow: d.getDay() };
  });
}

function dayGap(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86400000);
}

/** "Thu 11/12" */
function shortDay(isoDay: string) {
  const d = new Date(`${isoDay}T12:00:00`);
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getMonth() + 1}/${d.getDate()}`;
}

function monthDay(isoDay: string) {
  return new Date(`${isoDay}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Dark text on a light bar, white on a dark one. */
function inkOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#111";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111" : "#fff";
}

function byStatus(a: BoardJob, b: BoardJob) {
  return RANK[a.boardStatus] - RANK[b.boardStatus] || a.name.localeCompare(b.name);
}

interface ListProps {
  todayStr: string;
  onOpenProject: (projectId: string) => void;
  onOpenPhase: (bar: BoardBar) => void;
  onUpdate: (job: BoardJob) => void;
  /** Opens the job's whole schedule on its own screen. */
  onOpenSchedule: (job: BoardJob) => void;
}

export function BoardList({
  onsite,
  starting,
  review,
  ...rest
}: ListProps & {
  onsite: BoardJob[];
  starting: BoardJob[];
  /** Jobs outside the lanes that still have schedule problems. */
  review: BoardJob[];
}) {
  const active = onsite.filter((j) => !j.quiet).sort(byStatus);
  const quiet = [...onsite.filter((j) => j.quiet), ...review].sort(byStatus);
  const upToDate = active.filter((j) => j.boardStatus === "ok").length;
  const days = stripDays(rest.todayStr);

  if (!active.length && !starting.length && !quiet.length) {
    return <p className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">No jobs match.</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      {active.length > 0 && (
        <Group label="On site" count={active.length} note={`${upToDate} of ${active.length} up to date`}>
          {active.map((job) => (
            <JobCard key={job.id} job={job} days={days} {...rest} />
          ))}
        </Group>
      )}
      {starting.length > 0 && (
        <Group label="Starting soon" count={starting.length} className="mt-5">
          {starting.map((job) => (
            <JobCard key={job.id} job={job} days={days} {...rest} />
          ))}
        </Group>
      )}
      {quiet.length > 0 && (
        <details className="group mt-5 rounded-xl border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
            Not active
            <span className="tabular-nums">· {quiet.length}</span>
            <span className="ml-auto hidden text-xs sm:inline">no recent work and nothing coming up</span>
          </summary>
          <ul>
            {quiet.map((job) => (
              <QuietRow key={job.id} job={job} onOpenProject={rest.onOpenProject} onUpdate={rest.onUpdate} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Group({
  label,
  count,
  note,
  className,
  children,
}: {
  label: string;
  count: number;
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className={className}>
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
        {note && <span className="ml-auto text-xs text-muted-foreground">{note}</span>}
      </div>
      <ul className="grid gap-3 xl:grid-cols-2">{children}</ul>
    </section>
  );
}

function JobCard({
  job,
  days,
  todayStr,
  onOpenPhase,
  onUpdate,
  onOpenSchedule,
}: ListProps & { job: BoardJob; days: StripDay[] }) {
  const stale = job.staleSteps.length;
  const ok = job.boardStatus === "ok";
  const starting = job.status === "contracted";

  const now = job.workNow?.name ?? null;
  const next = job.workNext ?? (job.nextStep ? { ...job.nextStep, who: [] as string[] } : null);

  const foot = stale
    ? `${stale} step${stale === 1 ? "" : "s"} past the end date`
    : ok && job.confirmed
      ? `Confirmed ${fmtStamp(job.confirmed.at)} by ${firstName(job.confirmed.by)}`
      : job.confirmed
        ? `Last confirmed ${fmtStamp(job.confirmed.at)}`
        : "Not confirmed yet";

  return (
    <li className="flex overflow-hidden rounded-xl border border-border bg-card">
      <span className={cn("w-1 shrink-0", STATUS_DOT[job.boardStatus])} aria-hidden />
      <div className="min-w-0 flex-1 p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onOpenSchedule(job)}
              title="Open the full schedule"
              className="block max-w-full truncate text-left text-base font-semibold leading-tight hover:text-primary"
            >
              {job.name}
            </button>
            <p className="mt-1 text-xs text-muted-foreground">
              {job.pm ? firstName(job.pm.name) : "No PM"}
              {job.crewToday.length > 0 && (
                <span className="text-green-600 dark:text-green-400" title={job.crewToday.map((c) => c.name).join(", ")}>
                  {" "}
                  · {job.crewToday.length} on site
                </span>
              )}
            </p>
          </div>
          <span className={cn("shrink-0 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap", STATUS_PILL[job.boardStatus])}>
            {STATUS_LABEL[job.boardStatus]}
          </span>
        </div>

        <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Now</dt>
            <dd className="truncate" title={now ?? undefined}>
              {starting && job.startsInDays !== null && job.startDate ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {scheduleStartLabel(job.startsInDays)} · {shortDay(job.startDate)}
                </span>
              ) : job.unscheduled ? (
                <span className="text-red-600 dark:text-red-400">No schedule yet</span>
              ) : job.readyToClose ? (
                "Every step is done"
              ) : (
                (now ?? <span className="text-muted-foreground">Nothing on today</span>)
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Next</dt>
            <dd className="truncate" title={next?.name}>
              {next ? (
                <>
                  <span className="tabular-nums text-muted-foreground">{shortDay(next.startDate)}</span> {next.name}
                  {next.who.length > 0 && <span className="text-muted-foreground"> · {next.who.join(", ")}</span>}
                </>
              ) : job.readyToClose ? (
                "Ready to close out"
              ) : (
                <span className="text-red-600 dark:text-red-400">Nothing planned</span>
              )}
            </dd>
          </div>
        </dl>

        <Strip job={job} days={days} todayStr={todayStr} onOpenPhase={onOpenPhase} />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={cn("mr-auto text-xs", stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{foot}</span>
          <Button variant="outline" size="sm" className="h-9 px-3" onClick={() => onOpenSchedule(job)}>
            <GanttChartSquare className="mr-1.5 h-4 w-4" aria-hidden />
            Full schedule
          </Button>
          <Button variant={ok ? "outline" : "default"} size="sm" className="h-9 px-4" onClick={() => onUpdate(job)}>
            Update
          </Button>
        </div>
      </div>
    </li>
  );
}

/** This week and next as a small Gantt: trade work and inspections only. */
function Strip({
  job,
  days,
  todayStr,
  onOpenPhase,
}: {
  job: BoardJob;
  days: StripDay[];
  todayStr: string;
  onOpenPhase: (bar: BoardBar) => void;
}) {
  const first = days[0].str;
  const last = days[days.length - 1].str;
  const bars = job.bars
    .filter((b) => b.kind !== "crew" && isSiteWork(b.name) && b.endDate >= first && b.startDate <= last)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));

  // Pack into lanes: a bar takes the first lane whose last bar has ended.
  const laneEnds: string[] = [];
  const placed = bars.map((bar) => {
    let lane = laneEnds.findIndex((end) => end < bar.startDate);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = bar.endDate;
    return { bar, lane };
  });
  const shown = placed.filter((p) => p.lane < MAX_LANES);
  const more = placed.length - shown.length;
  const lanes = Math.max(1, Math.min(MAX_LANES, laneEnds.length));
  const cols = { gridTemplateColumns: `repeat(${STRIP_DAYS}, minmax(0, 1fr))` };

  return (
    <div className="mt-3">
      <div className="grid text-[10px] leading-4 text-muted-foreground" style={cols}>
        <span className="col-span-7 truncate">This week · {monthDay(days[0].str)}</span>
        <span className="col-span-7 truncate pl-1">Next week · {monthDay(days[7].str)}</span>
      </div>
      <div className="grid text-center text-[10px] leading-4" style={cols} aria-hidden>
        {days.map((d) => (
          <span
            key={d.str}
            className={cn(
              d.str === todayStr
                ? "rounded-sm bg-primary font-semibold text-primary-foreground"
                : d.dow === 0 || d.dow === 6
                  ? "text-muted-foreground/50"
                  : "text-muted-foreground",
            )}
          >
            {"SMTWTFS"[d.dow]}
          </span>
        ))}
      </div>
      <div className="relative mt-0.5 overflow-hidden rounded-md border border-border/60 bg-background/40" style={{ height: lanes * LANE_H + 4 }}>
        <div className="absolute inset-0 grid" style={cols} aria-hidden>
          {days.map((d, i) => (
            <span
              key={d.str}
              className={cn(
                (d.dow === 0 || d.dow === 6) && "bg-muted/50",
                d.str === todayStr && "bg-primary/15",
                i === 7 && "border-l border-border",
              )}
            />
          ))}
        </div>
        {shown.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
            Nothing scheduled these two weeks
          </p>
        )}
        {shown.map(({ bar, lane }) => {
          const from = Math.max(0, dayGap(first, bar.startDate));
          const to = Math.min(STRIP_DAYS - 1, dayGap(first, bar.endDate));
          const done = bar.status === "completed";
          const who = [...bar.subs, ...bar.crew];
          return (
            <button
              key={bar.id}
              type="button"
              onClick={() => onOpenPhase(bar)}
              title={`${bar.name}\n${shortDay(bar.startDate)}${bar.endDate !== bar.startDate ? ` to ${shortDay(bar.endDate)}` : ""}${who.length ? `\n${who.join(", ")}` : ""}${done ? "\nDone" : ""}`}
              className={cn(
                "absolute truncate px-1 text-left text-[10px] font-medium leading-[18px] hover:brightness-110",
                bar.startDate < first ? "rounded-r" : bar.endDate > last ? "rounded-l" : "rounded",
                done && "opacity-45 line-through",
              )}
              style={{
                left: `calc(${(from / STRIP_DAYS) * 100}% + 1px)`,
                width: `calc(${((to - from + 1) / STRIP_DAYS) * 100}% - 2px)`,
                top: lane * LANE_H + 3,
                height: 18,
                backgroundColor: bar.color,
                color: inkOn(bar.color),
              }}
            >
              {bar.name}
            </button>
          );
        })}
      </div>
      {more > 0 && <p className="mt-1 text-right text-[10px] text-muted-foreground">+{more} more in these two weeks</p>}
    </div>
  );
}

function QuietRow({
  job,
  onOpenProject,
  onUpdate,
}: {
  job: BoardJob;
  onOpenProject: (projectId: string) => void;
  onUpdate: (job: BoardJob) => void;
}) {
  const stale = job.staleSteps.length;
  return (
    <li className="flex items-center gap-3 border-t border-border px-3 py-2.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[job.boardStatus])} aria-hidden />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpenProject(job.id)}
          className="block max-w-full truncate text-left text-sm font-medium hover:text-primary"
        >
          {job.name}
        </button>
        <p className="truncate text-xs text-muted-foreground">
          {job.pm ? firstName(job.pm.name) : "No PM"} · {job.status.replace(/_/g, " ")}
          {stale > 0 && ` · ${stale} step${stale === 1 ? "" : "s"} past the end date`}
        </p>
      </div>
      <Button variant="ghost" size="sm" className="h-9 px-3" onClick={() => onUpdate(job)}>
        Update
      </Button>
    </li>
  );
}
