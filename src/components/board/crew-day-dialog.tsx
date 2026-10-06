"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarOff,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  assignCrewCells,
  clearCrewAssignment,
  clearCrewJobDay,
  removeCrewRun,
  setCrewAssignment,
} from "@/lib/actions/crew-board";
import type {
  CrewBoardData,
  CrewCell,
  CrewDay,
  CrewPerson,
  CrewProjectOption,
} from "@/lib/board/crew-board-data";
import { JobPicker } from "./crew-job-picker";
import {
  clipFrom,
  daysBetween,
  initials,
  longDate,
  movable,
  shortDay,
  shortJob,
  type CrewClip,
} from "./crew-helpers";

/**
 * One person, one day — and the fastest way to spread it around.
 *
 * Every job on the day is a card. Under it, this week and next as a row of
 * day buttons: lit where they're on that job. Tap a dark day to put them on
 * it too, tap a lit one to take it off. "Next day" is one tap, "Copy" picks
 * the job up so you can click it onto anyone's days on the grid.
 *
 * Built as a column, not the dialog's default grid: a long scope line used to
 * widen the grid track and push the form out past the box.
 */

interface Props {
  editing: { person: CrewPerson; date: string } | null;
  data: CrewBoardData;
  showWeekends: boolean;
  confirmDefault: boolean;
  onNavigate: (date: string) => void;
  onClose: () => void;
  onCopy: (clip: CrewClip) => void;
  /** Something was written — refresh the board. */
  onChanged: () => void;
}

type Result = { error?: string | null };

export function CrewDayDialog(props: Props) {
  const { editing, onClose } = props;
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex max-h-[min(88vh,780px)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[34rem]"
      >
        {editing && <DayPanel key={`${editing.person.key}|${editing.date}`} {...props} editing={editing} />}
      </DialogContent>
    </Dialog>
  );
}

function DayPanel({
  editing,
  data,
  showWeekends,
  confirmDefault,
  onNavigate,
  onClose,
  onCopy,
  onChanged,
}: Props & { editing: { person: CrewPerson; date: string } }) {
  const { person, date } = editing;
  const allDays = useMemo(() => data.weeks.flatMap((w) => w.days), [data.weeks]);
  const day = allDays.find((d) => d.str === date) ?? null;
  const ref = { personKind: person.kind, personId: person.id };

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** `${projectId}|${day}` → on/off, until the refreshed board says so itself. */
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  /** Saves still on the wire — a refresh mid-save mustn't wipe their guess. */
  const inflight = useRef<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const cellsOn = (d: string) => data.cells[person.key]?.[d] ?? [];
  const existing = cellsOn(date);
  const [adding, setAdding] = useState(existing.length === 0);

  // A fresh board replaces the guesses.
  useEffect(() => {
    setOptimistic((prev) => {
      const keep: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prev)) if (inflight.current.has(k)) keep[k] = v;
      return keep;
    });
  }, [data.cells]);

  // The days a card's buttons cover: this week and next.
  const stripDays = useMemo(() => {
    const wi = data.weeks.findIndex((w) => w.days.some((d) => d.str === date));
    const weeks = wi >= 0 ? data.weeks.slice(wi, wi + 2) : [];
    return weeks.map((w) =>
      w.days.filter(
        (d) => showWeekends || !d.isWeekend || (data.cells[person.key]?.[d.str]?.length ?? 0) > 0,
      ),
    );
  }, [data.weeks, data.cells, date, showWeekends, person.key]);

  const workdays = useMemo(
    () => allDays.filter((d) => showWeekends || !d.isWeekend),
    [allDays, showWeekends],
  );
  const idx = workdays.findIndex((d) => d.str === date);
  const prevDay = idx > 0 ? workdays[idx - 1] : null;
  const nextDay = idx >= 0 && idx < workdays.length - 1 ? workdays[idx + 1] : null;
  const nextWorkday = workdays.slice(idx + 1).find((d) => !d.holiday?.closed) ?? null;

  // ←/→ walk the days while nothing is being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // Alt+← is the browser's Back; an open menu owns its own arrows.
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
      if (t?.closest('[role="menu"],[role="listbox"]')) return;
      if (e.key === "ArrowLeft" && prevDay) {
        e.preventDefault();
        onNavigate(prevDay.str);
      }
      if (e.key === "ArrowRight" && nextDay) {
        e.preventDefault();
        onNavigate(nextDay.str);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevDay, nextDay, onNavigate]);

  const isOn = (projectId: string, d: string) =>
    optimistic[`${projectId}|${d}`] ?? cellsOn(d).some((c) => c.projectId === projectId);
  /** Lit by something this board can't take off — the job's own schedule. */
  const lockedOn = (projectId: string, d: string) =>
    isOn(projectId, d) &&
    optimistic[`${projectId}|${d}`] === undefined &&
    !cellsOn(d).some((c) => c.projectId === projectId && movable(c));

  const act = (key: string, work: () => Promise<Result>, after?: () => void) => {
    setError(null);
    setBusy(key);
    inflight.current.add(key);
    const undo = () =>
      setOptimistic((o) => {
        const next = { ...o };
        delete next[key];
        return next;
      });
    void work()
      .then((res) => {
        if (res.error) {
          setError(res.error);
          undo();
        } else {
          after?.();
        }
      })
      .catch(() => {
        setError("Couldn't save that. Refresh the board and try again.");
        undo();
      })
      .finally(() => {
        inflight.current.delete(key);
        setBusy(null);
        onChanged();
      });
  };

  const scopeOf = (c: CrewCell) => (c.name !== c.projectName ? c.name : "");

  /** Put them on this job that day — or take them off it. */
  const toggleDay = (card: CrewCell, d: string) => {
    if (!card.projectId) return;
    const key = `${card.projectId}|${d}`;
    if (isOn(card.projectId, d)) {
      if (!cellsOn(d).some((c) => c.projectId === card.projectId && movable(c))) return;
      setOptimistic((o) => ({ ...o, [key]: false }));
      // Found on the server by person + job + day: a quick earlier tap may
      // already have split the row this screen knows about.
      act(key, () => clearCrewJobDay({ ...ref, date: d, projectId: card.projectId as string }));
    } else {
      setOptimistic((o) => ({ ...o, [key]: true }));
      act(key, () =>
        assignCrewCells({
          cells: [{ ...ref, date: d }],
          projectId: card.projectId as string,
          scope: scopeOf(card),
          confirmed: card.confirmed,
        }),
      );
    }
  };

  const suggestionsFor = (projectId: string) => {
    const counts = new Map<string, number>();
    for (const row of Object.values(data.cells)) {
      for (const list of Object.values(row)) {
        for (const c of list) {
          if (c.projectId !== projectId || c.name === c.projectName) continue;
          counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n);
  };

  const actual = data.actualWork?.[person.key]?.[date] ?? [];
  const w = day?.weather;

  return (
    <>
      {/* ── Header ── */}
      <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 pb-3 pt-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
          {initials(person.name)}
        </span>
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-base font-semibold leading-tight">{person.name}</DialogTitle>
          <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="font-medium text-foreground/90">{longDate(date)}</span>
            {day?.isToday && <span className="rounded bg-primary/20 px-1.5 text-[10px] uppercase text-primary">today</span>}
            {w && (
              <span className={cn(w.wet && "text-sky-400")}>
                {w.icon} {w.high}°{w.precipChance >= 30 ? ` · ${w.precipChance}% rain` : ""}
              </span>
            )}
            {day?.holiday && (
              <span className={cn("inline-flex items-center gap-1", day.holiday.closed ? "text-red-400" : "")}>
                {day.holiday.closed && <CalendarOff className="h-3 w-3" aria-hidden />}
                {day.holiday.name}
                {day.holiday.closed ? " — closed" : ""}
              </span>
            )}
          </DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!prevDay}
            onClick={() => prevDay && onNavigate(prevDay.str)}
            title={prevDay ? `${longDate(prevDay.str)} (←)` : undefined}
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!nextDay}
            onClick={() => nextDay && onNavigate(nextDay.str)}
            title={nextDay ? `${longDate(nextDay.str)} (→)` : undefined}
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {existing.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">Nothing on {longDate(date)} yet.</p>
        )}

        {existing.map((c) =>
          editingId === c.phaseId ? (
            <JobForm
              key={c.phaseId}
              title={`Change ${shortJob(c.projectName)}`}
              projects={data.projects}
              initial={{ projectId: c.projectId ?? "", scope: scopeOf(c), confirmed: c.confirmed }}
              suggestionsFor={suggestionsFor}
              busy={busy === `edit|${c.phaseId}`}
              submitLabel="Save"
              onCancel={() => setEditingId(null)}
              onSubmit={(v) =>
                act(
                  `edit|${c.phaseId}`,
                  () =>
                    setCrewAssignment({
                      ...ref,
                      date,
                      projectId: v.projectId,
                      scope: v.scope,
                      confirmed: v.confirmed,
                      replacePhaseId: c.phaseId,
                    }),
                  () => setEditingId(null),
                )
              }
            />
          ) : (
            <JobCard
              key={c.phaseId}
              cell={c}
              date={date}
              today={data.todayStr}
              stripDays={stripDays}
              isOn={isOn}
              lockedOn={lockedOn}
              busy={busy}
              nextWorkday={nextWorkday}
              onToggleDay={(d) => toggleDay(c, d)}
              onCopy={() => {
                const clip = clipFrom(c);
                if (clip) onCopy(clip);
              }}
              onEdit={() => {
                setAdding(false);
                setEditingId(c.phaseId);
              }}
              onRemoveDay={() =>
                act(`remove|${c.phaseId}`, () =>
                  movable(c) && c.projectId
                    ? clearCrewJobDay({ ...ref, date, projectId: c.projectId })
                    : clearCrewAssignment({ ...ref, date, phaseId: c.phaseId }),
                )
              }
              onRemoveRun={() => act(`remove|${c.phaseId}`, () => removeCrewRun({ ...ref, phaseId: c.phaseId }))}
            />
          ),
        )}

        {adding ? (
          <AddForm
            key="add"
            data={data}
            person={person}
            date={date}
            stripDays={stripDays}
            confirmDefault={confirmDefault}
            suggestionsFor={suggestionsFor}
            busy={busy === "add"}
            showCancel={existing.length > 0}
            onCancel={() => setAdding(false)}
            onSubmit={(v, dates) =>
              act(
                "add",
                () =>
                  assignCrewCells({
                    cells: dates.map((d) => ({ ...ref, date: d })),
                    projectId: v.projectId,
                    scope: v.scope,
                    confirmed: v.confirmed,
                  }),
                () => setAdding(false),
              )
            }
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {existing.length ? "Add another job this day" : "Put them on a job"}
          </button>
        )}

        {actual.length > 0 && (
          <div className="space-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-500">What really happened · time logs</p>
            {actual.map((a, i) => (
              <p key={i} className="break-words text-xs">
                <span className="font-medium">
                  {a.clockedIn ? "On the clock: " : "Worked: "}
                  {a.projectName}
                </span>
                {a.task && <span className="text-muted-foreground"> — {a.task}</span>}
                {a.differsFromPlan && <span className="text-amber-500"> · not what was planned</span>}
                {a.notes && <span className="mt-0.5 block whitespace-pre-wrap text-muted-foreground line-clamp-3">{a.notes}</span>}
              </p>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="break-words rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

// ── A job on the day ─────────────────────────────────────────────

function JobCard({
  cell,
  date,
  today,
  stripDays,
  isOn,
  lockedOn,
  busy,
  nextWorkday,
  onToggleDay,
  onCopy,
  onEdit,
  onRemoveDay,
  onRemoveRun,
}: {
  cell: CrewCell;
  date: string;
  today: string;
  stripDays: CrewDay[][];
  isOn: (projectId: string, d: string) => boolean;
  lockedOn: (projectId: string, d: string) => boolean;
  busy: string | null;
  nextWorkday: CrewDay | null;
  onToggleDay: (d: string) => void;
  onCopy: () => void;
  onEdit: () => void;
  onRemoveDay: () => void;
  onRemoveRun: () => void;
}) {
  const own = movable(cell);
  const scope = cell.name !== cell.projectName ? cell.name : null;
  const span = cell.startDate && cell.endDate && cell.startDate !== cell.endDate ? daysBetween(cell.startDate, cell.endDate) + 1 : 1;
  const removing = busy === `remove|${cell.phaseId}`;
  // "All the days" means from today on — the days already worked stay.
  const restStart = cell.startDate && cell.startDate < today ? today : cell.startDate;
  const restDays = cell.endDate && restStart && cell.endDate >= restStart ? daysBetween(restStart, cell.endDate) + 1 : 0;
  const nextOn = nextWorkday && cell.projectId ? isOn(cell.projectId, nextWorkday.str) : false;
  const nextBusy = nextWorkday && busy === `${cell.projectId}|${nextWorkday.str}`;

  return (
    <div
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
      style={{ borderLeft: `4px solid ${cell.color}` }}
    >
      <div className="space-y-2.5 px-3.5 py-3">
        {/* name + status */}
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{cell.projectName}</p>
            {scope && <p className="mt-0.5 break-words text-sm leading-snug text-muted-foreground">{scope}</p>}
          </div>
          <StatusPill cell={cell} />
        </div>

        {span > 1 && (
          <p className="text-xs text-muted-foreground">
            {shortDay(cell.startDate)} → {shortDay(cell.endDate)} · {span} days
          </p>
        )}

        {/* the days this job covers */}
        {cell.projectId && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Days on this job · tap to add or take off
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {stripDays.map((week, wi) => (
                <div key={wi} className="flex items-center gap-1">
                  {wi > 0 && <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />}
                  {week.map((d) => {
                    const on = isOn(cell.projectId as string, d.str);
                    const key = `${cell.projectId}|${d.str}`;
                    // A lit day the board can't take off (it's the job's own schedule).
                    const locked = lockedOn(cell.projectId as string, d.str);
                    return (
                      <DayButton
                        key={d.str}
                        day={d}
                        on={on}
                        current={d.str === date}
                        color={cell.color}
                        locked={locked}
                        saving={busy === key}
                        onClick={() => onToggleDay(d.str)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* quick actions */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {nextWorkday && cell.projectId && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={nextOn || !!nextBusy}
              onClick={() => onToggleDay(nextWorkday.str)}
              title={nextOn ? `Already on ${shortDay(nextWorkday.str)}` : `Also put them on this job ${longDate(nextWorkday.str)}`}
            >
              {nextBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <ArrowRight className="mr-1 h-3.5 w-3.5" aria-hidden />}
              {nextOn ? `On ${nextWorkday.dayName}` : `Next day · ${nextWorkday.dayName}`}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={onCopy}
            title="Pick this job up, then click any day on the board to paste it"
          >
            <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
            Copy
          </Button>
          {own && (
            <Button variant="outline" size="sm" className="h-8" onClick={onEdit}>
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
              Edit
            </Button>
          )}
          <div className="ml-auto">
            {own && span > 1 && restDays > 0 && !(restDays === 1 && restStart === date) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-red-400" disabled={removing}>
                    {removing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />}
                    Remove
                    <ChevronDown className="ml-0.5 h-3 w-3" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onRemoveDay}>Just {longDate(date)}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onRemoveRun}>
                    {restStart === cell.startDate ? `All ${span} days` : `The rest, ${restDays} day${restDays === 1 ? "" : "s"}`} (
                    {shortDay(restStart)} → {shortDay(cell.endDate)})
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-muted-foreground hover:text-red-400"
                disabled={removing}
                onClick={onRemoveDay}
                title={
                  cell.source === "schedule"
                    ? "Takes them off every day of this step — it comes from the job's schedule"
                    : "Take them off this day"
                }
              >
                {removing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />}
                {cell.source === "schedule" ? "Off whole step" : "Remove"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ cell }: { cell: CrewCell }) {
  if (cell.source === "schedule") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground" title="From the job's schedule — move it on the Jobs view">
        <Lock className="h-3 w-3" aria-hidden />
        Job schedule
      </span>
    );
  }
  if (cell.source === "sub") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
        <Clock className="h-3 w-3" aria-hidden />
        Sub proposed
      </span>
    );
  }
  return cell.confirmed ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400" title="Shows on their phone">
      <Check className="h-3 w-3" aria-hidden />
      Confirmed
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-amber-500/60 px-2 py-0.5 text-[10px] font-medium text-amber-400" title="Only on the board — the crew doesn't see it yet">
      Proposed
    </span>
  );
}

function DayButton({
  day,
  on,
  current,
  color,
  locked,
  saving,
  onClick,
}: {
  day: CrewDay;
  on: boolean;
  current: boolean;
  color: string;
  locked?: boolean;
  saving?: boolean;
  onClick: () => void;
}) {
  const closed = !!day.holiday?.closed;
  const num = day.label.split("/")[1] ?? day.label;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={closed || locked || saving}
      title={`${longDate(day.str)}${closed ? ` — ${day.holiday?.name}, closed` : on ? " — on (tap to take off)" : " — tap to add"}`}
      className={cn(
        "relative flex h-10 w-9 shrink-0 flex-col items-center justify-center rounded-md border text-[10px] leading-none transition-colors",
        on ? "border-transparent font-semibold text-white" : "border-border text-muted-foreground hover:border-primary hover:text-foreground",
        current && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        closed && "cursor-not-allowed border-red-500/30 bg-red-500/10 text-red-400/70",
        day.isPast && !on && "opacity-60",
      )}
      style={on ? { backgroundColor: color } : undefined}
    >
      <span className="uppercase">{day.dayName.slice(0, 2)}</span>
      <span className="mt-0.5 text-xs tabular-nums">{num}</span>
      {saving && <Loader2 className="absolute -right-1 -top-1 h-3 w-3 animate-spin text-foreground" aria-hidden />}
      {locked && <Lock className="absolute -right-1 -top-1 h-3 w-3 text-foreground/70" aria-hidden />}
    </button>
  );
}

// ── Job + words + confirmed ──────────────────────────────────────

interface JobValues {
  projectId: string;
  scope: string;
  confirmed: boolean;
}

/** The jobs worth one tap: running ones first, then active. */
function quickJobs(projects: CrewProjectOption[], current: string) {
  const ranked = [...projects].sort((a, b) => {
    const r = (p: CrewProjectOption) => (p.group === "running" ? 0 : p.group === "active" ? 1 : 2);
    return r(a) - r(b);
  });
  const top = ranked.slice(0, 8);
  const chosen = projects.find((p) => p.id === current);
  return chosen && !top.some((p) => p.id === chosen.id) ? [chosen, ...top.slice(0, 7)] : top;
}

function JobFields({
  projects,
  value,
  onChange,
  suggestionsFor,
}: {
  projects: CrewProjectOption[];
  value: JobValues;
  onChange: (v: JobValues) => void;
  suggestionsFor: (projectId: string) => string[];
}) {
  const quick = quickJobs(projects, value.projectId);
  const suggestions = value.projectId ? suggestionsFor(value.projectId).filter((s) => s !== value.scope) : [];
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Job</p>
        <div className="flex flex-wrap gap-1.5">
          {quick.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange({ ...value, projectId: p.id })}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                value.projectId === p.id ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
              <span className="truncate">{shortJob(p.name)}</span>
            </button>
          ))}
        </div>
        <JobPicker
          projects={projects}
          value={value.projectId}
          onChange={(id) => onChange({ ...value, projectId: id })}
          compact
          placeholder="Another job…"
        />
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">What they&apos;re doing</p>
        <Input
          value={value.scope}
          onChange={(e) => onChange({ ...value, scope: e.target.value })}
          placeholder="Trim, demo, framing with John…"
          maxLength={120}
        />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...value, scope: s })}
                className="max-w-full truncate rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                title={s}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={value.confirmed} onCheckedChange={(v) => onChange({ ...value, confirmed: v === true })} />
        Confirmed — shows on their phone
      </label>
    </div>
  );
}

function JobForm({
  title,
  projects,
  initial,
  suggestionsFor,
  busy,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  title: string;
  projects: CrewProjectOption[];
  initial: JobValues;
  suggestionsFor: (projectId: string) => string[];
  busy: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (v: JobValues) => void;
}) {
  const [value, setValue] = useState<JobValues>(initial);
  const ok = projects.some((p) => p.id === value.projectId);
  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-primary/50 bg-card px-3.5 py-3">
      <p className="text-sm font-semibold">{title}</p>
      <JobFields projects={projects} value={value} onChange={setValue} suggestionsFor={suggestionsFor} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSubmit(value)} disabled={!ok || busy}>
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function AddForm({
  data,
  person,
  date,
  stripDays,
  confirmDefault,
  suggestionsFor,
  busy,
  showCancel,
  onCancel,
  onSubmit,
}: {
  data: CrewBoardData;
  person: CrewPerson;
  date: string;
  stripDays: CrewDay[][];
  confirmDefault: boolean;
  suggestionsFor: (projectId: string) => string[];
  busy: boolean;
  showCancel: boolean;
  onCancel: () => void;
  onSubmit: (v: JobValues, dates: string[]) => void;
}) {
  const [value, setValue] = useState<JobValues>({ projectId: "", scope: "", confirmed: confirmDefault });
  const [dates, setDates] = useState<Set<string>>(new Set([date]));
  const ok = data.projects.some((p) => p.id === value.projectId) && dates.size > 0;
  const color = data.projects.find((p) => p.id === value.projectId)?.color ?? "#d97706";

  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-primary/50 bg-card px-3.5 py-3">
      <p className="text-sm font-semibold">Put {person.name.split(" ")[0]} on a job</p>
      <JobFields projects={data.projects} value={value} onChange={setValue} suggestionsFor={suggestionsFor} />
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Days · tap to add more</p>
        <div className="flex flex-wrap items-center gap-1">
          {stripDays.map((week, wi) => (
            <div key={wi} className="flex items-center gap-1">
              {wi > 0 && <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />}
              {week.map((d) => (
                <DayButton
                  key={d.str}
                  day={d}
                  on={dates.has(d.str)}
                  current={d.str === date}
                  color={color}
                  onClick={() =>
                    setDates((prev) => {
                      const next = new Set(prev);
                      if (next.has(d.str)) next.delete(d.str);
                      else next.add(d.str);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {showCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button size="sm" onClick={() => onSubmit(value, Array.from(dates).sort())} disabled={!ok || busy}>
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
          {dates.size > 1 ? `Add to ${dates.size} days` : "Add"}
        </Button>
      </div>
    </div>
  );
}
