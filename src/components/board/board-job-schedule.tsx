"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BoardJob, BoardScheduleStep } from "@/lib/board/board-data";
import { isAdminStep, isOverheadStep } from "@/lib/board/step-kind";
import { STATUS_LABEL, STATUS_PILL, firstName } from "./board-list";

/**
 * One job's whole schedule, start to finish, on its own screen.
 *
 * Every step is a line you can read: its name and dates on the left, its bar
 * on the right with who is on it written beside the bar. Lines are grouped by
 * when they happen (on now, later this week, next week, then week by week),
 * and finished steps fold away so what is left stands out. A phone gets the
 * same lines without the bars.
 */

type Kind = "work" | "inspection" | "admin";

interface Row {
  step: BoardScheduleStep;
  kind: Kind;
  done: boolean;
  late: boolean;
}

interface Section {
  key: string;
  label: string;
  tone?: "amber" | "primary" | "muted";
  rows: Row[];
}

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function gap(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86400000);
}

function mondayOf(iso: string) {
  const dow = new Date(`${iso}T12:00:00`).getDay();
  return shift(iso, -((dow + 6) % 7));
}

/** "Thu 11/12" */
function shortDay(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getMonth() + 1}/${d.getDate()}`;
}

function monthDay(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function rangeText(step: BoardScheduleStep) {
  return step.startDate === step.endDate ? shortDay(step.startDate) : `${shortDay(step.startDate)} → ${shortDay(step.endDate)}`;
}

function kindOf(step: BoardScheduleStep): Kind {
  if (step.eventType === "inspection") return "inspection";
  return isAdminStep(step.name) ? "admin" : "work";
}

/** Section labels and step rows share this grid on a tablet and up. */
const GRID = "sm:grid sm:grid-cols-[17rem_minmax(0,1fr)] lg:grid-cols-[24rem_minmax(0,1fr)]";
const TRACK_INSET = "left-[17rem] lg:left-[24rem]";

export function BoardJobSchedule({
  job,
  todayStr,
  onBack,
  onOpenStep,
  onUpdate,
  onAddStep,
  onOpenProject,
}: {
  job: BoardJob;
  todayStr: string;
  onBack: () => void;
  onOpenStep: (step: BoardScheduleStep) => void;
  onUpdate: () => void;
  onAddStep: () => void;
  onOpenProject: () => void;
}) {
  const [showDone, setShowDone] = useState(false);

  const { sections, doneCount, total, overhead, spanStart, spanEnd, nextInspection } = useMemo(() => {
    const nextMonday = shift(mondayOf(todayStr), 7);
    const rows: Row[] = job.schedule
      .filter((s) => !isOverheadStep(s.name))
      .map((step) => {
        const done = step.status === "completed";
        return { step, kind: kindOf(step), done, late: !done && step.endDate < todayStr };
      });

    const bucket = new Map<string, Section>();
    const put = (key: string, label: string, row: Row, tone?: Section["tone"]) => {
      const hit = bucket.get(key);
      if (hit) hit.rows.push(row);
      else bucket.set(key, { key, label, tone, rows: [row] });
    };
    for (const row of rows) {
      const { step } = row;
      if (row.done) put("0-done", "Finished", row, "muted");
      else if (row.late) put("1-late", "Past the end date", row, "amber");
      else if (step.startDate <= todayStr) put("2-now", "On now", row, "primary");
      else if (step.startDate < nextMonday) put("3-week", "Later this week", row);
      else if (step.startDate < shift(nextMonday, 7)) put("4-next", "Next week", row);
      else {
        const monday = mondayOf(step.startDate);
        put(`5-${monday}`, `Week of ${monthDay(monday)}`, row);
      }
    }
    const work = rows.filter((r) => r.kind !== "admin");
    return {
      sections: Array.from(bucket.values()).sort((a, b) => a.key.localeCompare(b.key)),
      doneCount: rows.filter((r) => r.done).length,
      total: rows.length,
      overhead: job.schedule.filter((s) => isOverheadStep(s.name) && s.status !== "completed"),
      spanStart: rows.reduce<string | null>((acc, r) => (!acc || r.step.startDate < acc ? r.step.startDate : acc), null),
      spanEnd: work.reduce<string | null>((acc, r) => (!acc || r.step.endDate > acc ? r.step.endDate : acc), null),
      nextInspection: rows.find((r) => r.kind === "inspection" && !r.done && r.step.endDate >= todayStr)?.step ?? null,
    };
  }, [job.schedule, todayStr]);

  const shown = sections.filter((s) => showDone || s.key !== "0-done");
  const shownRows = shown.flatMap((s) => s.rows);

  // The time the bars cover: from the earliest line on screen (or today) to
  // the last, squared off to whole weeks so the Monday lines land cleanly.
  const first = mondayOf(shownRows.reduce((acc, r) => (r.step.startDate < acc ? r.step.startDate : acc), todayStr));
  const lastRaw = shownRows.reduce((acc, r) => (r.step.endDate > acc ? r.step.endDate : acc), shift(todayStr, 13));
  const last = shift(mondayOf(lastRaw), 6);
  const days = gap(first, last) + 1;
  const pct = (iso: string) => (gap(first, iso) / days) * 100;
  const dayPct = 100 / days;
  const weeks = Array.from({ length: Math.ceil(days / 7) }, (_, i) => shift(first, i * 7));
  const labelEvery = weeks.length > 26 ? 4 : weeks.length > 13 ? 2 : 1;
  const todayIn = todayStr >= first && todayStr <= last;
  const percentDone = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── The job ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
          All jobs
        </Button>
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="truncate text-lg leading-tight font-semibold">{job.name}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {job.pm ? firstName(job.pm.name) : "No PM"}
            {spanStart && spanEnd && ` · ${shortDay(spanStart)} → ${shortDay(spanEnd)}`}
            {job.crewToday.length > 0 && <span className="text-green-600 dark:text-green-400"> · {job.crewToday.length} on site</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap", STATUS_PILL[job.boardStatus])}>
            {STATUS_LABEL[job.boardStatus]}
          </span>
          <Button variant="outline" size="sm" className="h-9" aria-label="Add step" onClick={onAddStep}>
            <Plus className="h-4 w-4 sm:mr-1" aria-hidden />
            <span className="hidden sm:inline">Add step</span>
          </Button>
          <Button size="sm" className="h-9 px-4" onClick={onUpdate}>
            Update
          </Button>
        </div>
      </div>

      {/* ── How far along ── */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <div className="flex min-w-48 flex-1 items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-green-500" style={{ width: `${percentDone}%` }} />
          </div>
          <span className="whitespace-nowrap tabular-nums text-foreground">
            {doneCount} of {total} steps done
          </span>
        </div>
        {nextInspection && (
          <span className="whitespace-nowrap">
            Next inspection <span className="text-foreground">{shortDay(nextInspection.startDate)}</span>
          </span>
        )}
        {doneCount > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="h-4 w-4 accent-amber-600" />
            Show finished
          </label>
        )}
        <button type="button" onClick={onOpenProject} className="whitespace-nowrap underline underline-offset-2 hover:text-foreground">
          Job details
        </button>
      </div>

      {/* ── The schedule ── */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card">
        {shownRows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {total === 0 ? "This job has no schedule yet. Add the first step." : "Every step is done."}
          </p>
        ) : (
          <div className="relative">
            {/* Weekends, week lines and today, behind every row. Tablet and up. */}
            <div className={cn("pointer-events-none absolute inset-y-0 right-0 hidden sm:block", TRACK_INSET)} aria-hidden>
              {days <= 98 &&
                weeks.map((w) => (
                  <span
                    key={`we-${w}`}
                    className="absolute inset-y-0 bg-muted/30"
                    style={{ left: `${pct(shift(w, 5))}%`, width: `${dayPct * 2}%` }}
                  />
                ))}
              {weeks.map((w) => (
                <span key={w} className="absolute inset-y-0 border-l border-border/70" style={{ left: `${pct(w)}%` }} />
              ))}
              {todayIn && (
                <span
                  className="absolute inset-y-0 border-x border-primary/50 bg-primary/15"
                  style={{ left: `${pct(todayStr)}%`, width: `${Math.max(dayPct, 0.4)}%` }}
                />
              )}
            </div>

            {/* Dates across the top */}
            <div className={cn("sticky top-0 z-20 hidden border-b border-border bg-card", GRID)}>
              <div className="flex items-end px-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Step</div>
              <div className="relative h-11">
                {weeks.map((w, i) =>
                  i % labelEvery === 0 ? (
                    <span
                      key={w}
                      className="absolute top-1 pl-1.5 text-xs whitespace-nowrap tabular-nums text-muted-foreground"
                      style={{ left: `${pct(w)}%` }}
                    >
                      {i === 0 || w.slice(5, 7) !== weeks[i - labelEvery]?.slice(5, 7) ? monthDay(w) : Number(w.slice(8))}
                    </span>
                  ) : null,
                )}
                {todayIn && (
                  <span
                    className="absolute bottom-1 -translate-x-1/2 rounded bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground"
                    style={{ left: `${pct(todayStr) + dayPct / 2}%` }}
                  >
                    Today
                  </span>
                )}
              </div>
            </div>

            {shown.map((section) => (
              <div key={section.key}>
                <div
                  className={cn(
                    "relative z-10 border-b border-border/60 bg-muted px-3 py-1.5 text-xs font-semibold",
                    section.tone === "amber" && "text-amber-600 dark:text-amber-400",
                    section.tone === "primary" && "text-primary",
                    section.tone === "muted" && "text-muted-foreground",
                  )}
                >
                  {section.label}
                  <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{section.rows.length}</span>
                </div>
                {section.rows.map(({ step, kind, done, late }) => {
                  const from = step.startDate < first ? first : step.startDate;
                  const left = pct(from);
                  const width = (gap(from, step.endDate) + 1) * dayPct;
                  const who = step.who.join(", ");
                  // The name of who is on it sits beside the bar: after it, or
                  // before it when the bar runs into the right edge.
                  const labelAfter = left + width < 68;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => onOpenStep(step)}
                      title={`${step.name}\n${rangeText(step)}${who ? `\n${who}` : ""}`}
                      className={cn("block w-full border-b border-border/40 text-left hover:bg-muted/40", GRID)}
                    >
                      <span className="flex min-w-0 items-center gap-2.5 px-3 py-2">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                          {done ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : kind === "inspection" ? (
                            <span className="block h-2.5 w-2.5 rotate-45 rounded-[2px]" style={{ backgroundColor: step.color }} />
                          ) : kind === "admin" ? (
                            <span className="block h-2.5 w-2.5 rounded-sm border-2" style={{ borderColor: step.color }} />
                          ) : (
                            <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: step.color }} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("line-clamp-2 text-sm leading-snug", done && "text-muted-foreground line-through")}>
                            {step.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {rangeText(step)}
                            {who && <span className="text-foreground/80 sm:hidden"> · {who}</span>}
                            {late && <span className="text-amber-600 dark:text-amber-400"> · past the end date</span>}
                          </span>
                        </span>
                      </span>
                      <span className="relative hidden min-h-12 overflow-hidden sm:block">
                        {kind === "inspection" ? (
                          <span
                            className="absolute top-1/2 block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px]"
                            style={{ left: `${left + dayPct / 2}%`, backgroundColor: step.color, opacity: done ? 0.4 : 1 }}
                          />
                        ) : (
                          <span
                            className={cn("absolute top-1/2 block h-6 min-w-2.5 -translate-y-1/2 rounded-md", kind === "admin" && "border-2 bg-transparent")}
                            style={{
                              left: `calc(${left}% + 1px)`,
                              width: `calc(${width}% - 2px)`,
                              ...(kind === "admin" ? { borderColor: step.color } : { backgroundColor: step.color }),
                              opacity: done ? 0.4 : 1,
                            }}
                          />
                        )}
                        {who && (
                          <span
                            className="absolute top-1/2 max-w-[42%] -translate-y-1/2 truncate text-xs text-foreground/80"
                            style={
                              labelAfter
                                ? { left: `calc(${left + Math.max(width, dayPct)}% + 8px)` }
                                : { right: `calc(${100 - left}% + 8px)` }
                            }
                          >
                            {who}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {overhead.length > 0 && (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          On site the whole job: {overhead.map((s) => `${s.name} (to ${shortDay(s.endDate)})`).join(" · ")}
        </p>
      )}
    </div>
  );
}
