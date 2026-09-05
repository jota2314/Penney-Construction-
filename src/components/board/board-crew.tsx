"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarOff,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  Copy,
  Lock,
  Loader2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  clearCrewAssignment,
  moveCrewAssignment,
  setCrewAssignment,
} from "@/lib/actions/crew-board";
import type {
  CrewBoardData,
  CrewCell,
  CrewDay,
  CrewPerson,
  CrewProjectOption,
} from "@/lib/board/crew-board-data";

/**
 * The crew board — people down the side, days across, one week per block.
 *
 * Built to match the way Jorge already plans: tap a day, say which job and
 * what they're doing, done. Or grab a chip and drag it onto another name or
 * another day. Solid chips are confirmed and show up on the crew's own /crew
 * view; dashed ones are proposed and stay here.
 *
 * A chip only moves if this board wrote it. A master-schedule phase spans days
 * and people this grid can't see, so it carries a lock and stays put — the
 * project page is where those move.
 *
 * Day headers carry the North Shore forecast and the holidays Penney actually
 * closes for, because both of them are why a day gets replanned.
 */

const NAME_W = 168;
const DAY_MIN_W = 132;

interface Props {
  data: CrewBoardData;
}

interface Editing {
  person: CrewPerson;
  date: string;
  copied?: CrewCell;
}

interface DragPayload {
  phaseId: string;
  personKey: string;
  personKind: "employee" | "sub";
  personId: string;
  date: string;
  projectName: string;
}

function longDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** A chip is draggable only when this board owns it outright. */
function movable(cell: CrewCell) {
  return cell.source === "board" && !cell.shared;
}

export function BoardCrew({ data }: Props) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  const [weeksShown, setWeeksShown] = useState(1);
  const maxFrom = Math.max(0, data.weeks.length - weeksShown);
  const [from, setFrom] = useState(Math.min(data.thisWeekIndex, maxFrom));
  const [showWeekends, setShowWeekends] = useState(false);
  const [showProposed, setShowProposed] = useState(false);
  const [extraSubs, setExtraSubs] = useState<CrewPerson[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [addingSub, setAddingSub] = useState(false);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, startMoving] = useTransition();
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<CrewCell | null>(null);
  const [pasting, setPasting] = useState(false);
  const [notice, setNotice] = useState("");

  const copy = (cell: CrewCell) => {
    if (!cell.projectId) return;
    setCopied({ ...cell });
    setPasting(true);
    setNotice(`Copied ${cell.projectName}. Choose a destination day to review and save.`);
    setEditing(null);
  };

  const people = useMemo(() => {
    const seen = new Set(data.people.map((p) => p.key));
    return [...data.people, ...extraSubs.filter((p) => !seen.has(p.key))];
  }, [data.people, extraSubs]);

  const subChoices = useMemo(() => {
    const onBoard = new Set(people.filter((p) => p.kind === "sub").map((p) => p.id));
    return data.subs.filter((s) => !onBoard.has(s.id));
  }, [data.subs, people]);

  const visiblePeople = people.filter((person) =>
    `${person.name} ${person.title ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const weeks = data.weeks.slice(from, from + weeksShown);

  const drop = (person: CrewPerson, date: string) => {
    const payload = drag;
    setDrag(null);
    setOver(null);
    if (!payload || moving) return;
    if (payload.personKey === person.key && payload.date === date) return;
    setMoveError(null);
    startMoving(async () => {
      try {
      const res = await moveCrewAssignment({
        phaseId: payload.phaseId,
        fromKind: payload.personKind,
        fromId: payload.personId,
        fromDate: payload.date,
        toKind: person.kind,
        toId: person.id,
        toDate: date,
      });
      if (res.error) setMoveError(res.error);
      else router.refresh();
      } catch {
        setMoveError("Couldn't confirm the move. Refresh the board before trying again.");
      }
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Input aria-label="Find crew" placeholder="Find crew…" value={query}
            onChange={(e) => setQuery(e.target.value)} className="h-8 w-40" />
          <select aria-label="Weeks to display" value={weeksShown}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            onChange={(e) => {
              const count = Number(e.target.value);
              setWeeksShown(count);
              setFrom((f) => Math.min(f, Math.max(0, data.weeks.length - count)));
            }}>
            <option value={1}>1 week</option><option value={2}>2 weeks</option><option value={4}>4 weeks</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFrom((f) => Math.max(0, f - 1))}
            disabled={from === 0}
            aria-label="Earlier week"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFrom((f) => Math.min(maxFrom, f + 1))}
            disabled={from >= maxFrom}
            aria-label="Later week"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFrom(Math.min(data.thisWeekIndex, maxFrom))}
            disabled={from === Math.min(data.thisWeekIndex, maxFrom)}
          >
            This week
          </Button>
          <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={showWeekends}
              onCheckedChange={(v) => setShowWeekends(v === true)}
              aria-label="Show weekends"
            />
            Weekends
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={showProposed} onCheckedChange={(v) => setShowProposed(v === true)}
              aria-label="Show proposed assignments" />
            Show proposed
          </label>
          {moving && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Moving
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-foreground/70" /> confirmed — crew see it
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-foreground/60" /> proposed
          </span>
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3" aria-hidden /> from the job&apos;s schedule
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden /> the sub scheduled it
          </span>
          <span className="hidden sm:inline">drag a chip to move it</span>
          {subChoices.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setAddingSub(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              Add sub
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Open an assignment to copy it. Keyboard: focus a day, Ctrl/Cmd+C, then Ctrl/Cmd+V on the destination.</span>
        {copied && <Button variant={pasting ? "default" : "outline"} size="sm"
          onClick={() => setPasting((value) => !value)}>
          {pasting ? "Cancel paste" : `Paste ${copied.projectName}`}
        </Button>}
        <span role="status" aria-live="polite">{pasting ? notice : ""}</span>
      </div>

      {moveError && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-400">
          {moveError}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-auto pb-4">
        {visiblePeople.length === 0 && <p role="status" className="p-4 text-sm text-muted-foreground">No crew match your search.</p>}
        {weeks.map((week) => {
          const days = week.days.filter((d) => showWeekends || !d.isWeekend);
          const closed = week.days.filter((d) => d.holiday?.closed);
          return (
            <section key={week.start} className="rounded-lg border border-border bg-card">
              <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Week of {week.label}
                {closed.map((d) => (
                  <span
                    key={d.str}
                    className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-red-400"
                  >
                    <CalendarOff className="h-3 w-3" aria-hidden />
                    {d.holiday?.name} — closed {d.dayName}
                  </span>
                ))}
              </h3>
              <div className="max-h-[65vh] overflow-auto">
                <table
                  className="w-full table-fixed border-separate border-spacing-0 text-sm"
                  style={{ minWidth: NAME_W + days.length * DAY_MIN_W }}
                >
                  <thead>
                    <tr>
                      <th
                        className="sticky left-0 top-0 z-30 border-b border-border bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-foreground"
                        style={{ width: NAME_W, minWidth: NAME_W }}
                      >
                        Crew
                      </th>
                      {days.map((d) => (
                        <DayHead key={d.str} day={d} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePeople.map((person) => (
                      <tr key={person.key} className="border-t border-border">
                        <td
                          className="sticky left-0 z-10 bg-card px-3 py-2 align-top"
                          style={{ width: NAME_W, minWidth: NAME_W }}
                        >
                          <div className="flex items-center gap-1.5 font-medium leading-tight">
                            {person.kind === "sub" && (
                              <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            )}
                            <span className="truncate">{person.name}</span>
                          </div>
                          {person.title && (
                            <div className="truncate text-[11px] text-muted-foreground">{person.title}</div>
                          )}
                        </td>
                        {days.map((d) => {
                          const actual = data.actualWork?.[person.key]?.[d.str] ?? [];
                          const allCells = data.cells[person.key]?.[d.str] ?? [];
                          const cells = showProposed ? allCells : allCells.filter((c) => c.confirmed);
                          const hiddenProposed = allCells.length - cells.length;
                          const dropKey = `${person.key}|${d.str}`;
                          const isOver = over === dropKey && !!drag;
                          return (
                            <td
                              key={d.str}
                              onDragOver={(e) => {
                                if (!drag || moving) return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                setOver(dropKey);
                              }}
                              onDragLeave={() => setOver((o) => (o === dropKey ? null : o))}
                              onDrop={(e) => {
                                e.preventDefault();
                                drop(person, d.str);
                              }}
                              className={cn(
                                "border-b border-l border-border p-0 align-top transition-colors",
                                d.isPast && "bg-muted/40",
                                d.isToday && "bg-amber-500/5",
                                d.holiday?.closed && "bg-red-500/[0.07]",
                                isOver && "bg-amber-400/20 outline outline-2 -outline-offset-2 outline-amber-400",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing({ person, date: d.str, copied: pasting && copied ? copied : undefined });
                                  setPasting(false);
                                }}
                                onKeyDown={(e) => {
                                  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
                                  if (e.key.toLowerCase() === "c") {
                                    if (cells.length === 1 && cells[0].projectId) {
                                      e.preventDefault();
                                      copy(cells[0]);
                                    } else if (cells.length > 1) {
                                      e.preventDefault();
                                      setEditing({ person, date: d.str });
                                    }
                                  } else if (e.key.toLowerCase() === "v" && copied) {
                                    e.preventDefault();
                                    setEditing({ person, date: d.str, copied });
                                    setPasting(false);
                                  }
                                }}
                                className="flex min-h-[64px] w-full flex-col gap-1 px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
                                aria-label={`${person.name}, ${longDate(d.str)}`}
                              >
                                {cells.length === 0 ? (
                                  <span className="text-xs text-muted-foreground/50">
                                    {d.holiday?.closed ? d.holiday.name : "—"}
                                  </span>
                                ) : (
                                  cells.map((c) => (
                                    <Chip
                                      key={c.phaseId}
                                      cell={c}
                                      dragging={drag?.phaseId === c.phaseId && drag?.date === d.str}
                                      onDragStart={() =>
                                        setDrag({
                                          phaseId: c.phaseId,
                                          personKey: person.key,
                                          personKind: person.kind,
                                          personId: person.id,
                                          date: d.str,
                                          projectName: c.projectName,
                                        })
                                      }
                                      onDragEnd={() => {
                                        setDrag(null);
                                        setOver(null);
                                      }}
                                    />
                                  ))
                                )}
                                {actual.length > 0 && <span className="block border-t border-emerald-500/30 pt-2 mt-2 space-y-1">
                                  <span className="block text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Actual work · from time logs</span>
                                  {actual.map((work, i) => <span key={i} className="block rounded bg-emerald-500/10 px-2 py-1 text-xs">
                                    <span className="block font-semibold">{work.clockedIn ? "Clocked in: " : "Worked: "}{work.projectName}</span>
                                    <span className="block">{work.task}</span>
                                    {work.notes && <span className="block whitespace-pre-wrap text-xs line-clamp-4" title={work.notes}>{work.notes}</span>}
                                    {work.differsFromPlan && <span className="block text-amber-600 dark:text-amber-400">Different from confirmed plan</span>}
                                  </span>)}
                                </span>}
                                {data.actualWorkUnavailable && d.isToday && <span className="block text-xs text-amber-500">Time logs unavailable</span>}
                                {hiddenProposed > 0 && <span className="text-xs text-muted-foreground">
                                  {hiddenProposed} proposed · open to review
                                </span>}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      <CellEditor
        editing={editing}
        data={data}
        onCopy={copy}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <AddSubDialog
        open={addingSub}
        choices={subChoices}
        onClose={() => setAddingSub(false)}
        onPick={(s) => {
          setExtraSubs((prev) => [
            ...prev,
            { key: `sub:${s.id}`, kind: "sub", id: s.id, name: s.name, title: "Sub" },
          ]);
          setAddingSub(false);
        }}
      />
    </div>
  );
}

// ── Day header: date, holiday, forecast ──────────────────────────

function DayHead({ day }: { day: CrewDay }) {
  const w = day.weather;
  const closed = day.holiday?.closed;
  return (
    <th
      className={cn(
        "sticky top-0 z-20 border-b border-l border-border bg-card px-2 py-2 text-left align-top text-xs font-semibold uppercase tracking-wider",
        day.isToday ? "text-amber-400" : "text-foreground",
        closed && "text-red-400",
      )}
      style={{ minWidth: DAY_MIN_W }}
    >
      <div className="flex items-baseline gap-1.5">
        <span>
          {day.dayName} {day.label}
        </span>
        {day.isToday && <span className="text-[10px]">· today</span>}
      </div>

      {day.holiday && (
        <div
          className={cn(
            "mt-0.5 flex items-center gap-1 text-[10px] font-medium normal-case tracking-normal",
            closed ? "text-red-400" : "text-muted-foreground/70",
          )}
        >
          {closed && <CalendarOff className="h-2.5 w-2.5 shrink-0" aria-hidden />}
          <span className="truncate">
            {day.holiday.name}
            {closed ? " — closed" : ""}
          </span>
        </div>
      )}

      {w && (
        <div
          className={cn(
            "mt-0.5 flex items-center gap-1 text-[10px] font-medium normal-case tracking-normal tabular-nums",
            w.wet ? "text-sky-400" : "text-muted-foreground/70",
          )}
          title={`${w.label} · high ${w.high}° low ${w.low}° · rain ${w.precipChance}%${
            w.precipTotal >= 0.1 ? ` · ${w.precipTotal}"` : ""
          } · wind ${w.windMax} mph`}
        >
          <span aria-hidden>{w.icon}</span>
          <span>{w.high}°</span>
          {w.precipChance >= 30 && <span>{w.precipChance}%</span>}
          {w.windMax >= 25 && <span>{w.windMax}mph</span>}
        </div>
      )}
    </th>
  );
}

// ── Chip ─────────────────────────────────────────────────────────

function Chip({
  cell,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  cell: CrewCell;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const scope = cell.name !== cell.projectName ? cell.name : null;
  const canMove = movable(cell);
  const origin =
    cell.source === "board"
      ? ""
      : cell.source === "sub"
        ? " · the sub scheduled this"
        : " · from the job's schedule";
  return (
    <span
      draggable={canMove}
      onDragStart={(e) => {
        if (!canMove) return;
        e.stopPropagation();
        // Firefox refuses to start a drag without payload on the transfer.
        e.dataTransfer.setData("text/plain", cell.phaseId);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "block w-full rounded px-2 py-1.5 text-sm leading-snug text-foreground",
        dragging && "opacity-40",
        canMove ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
      style={{
        backgroundColor: `${cell.color}26`,
        borderLeft: `3px solid ${cell.color}`,
        outline: cell.confirmed ? "none" : `1px dashed ${cell.color}`,
        outlineOffset: -1,
      }}
      title={`${cell.projectName}${scope ? ` — ${scope}` : ""}${
        cell.confirmed ? "" : " (proposed)"
      }${cell.shared ? " · with others" : ""}${origin}${
        canMove ? "" : " — move it on the project page"
      }`}
    >
      <span className="flex items-center gap-1 font-medium">
        <span className="truncate">{cell.projectName}</span>
        {cell.source === "schedule" && <Lock className="h-3 w-3 shrink-0 opacity-60" aria-hidden />}
        {cell.source === "sub" && <Clock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />}
      </span>
      {scope && <span className="block truncate text-xs text-foreground/80">{scope}</span>}
    </span>
  );
}

// ── Editor ───────────────────────────────────────────────────────

function CellEditor({
  editing,
  data,
  onClose,
  onSaved,
  onCopy,
}: {
  editing: Editing | null;
  data: CrewBoardData;
  onClose: () => void;
  onSaved: () => void;
  onCopy: (cell: CrewCell) => void;
}) {
  // Keyed on the cell so the form resets every time a different day opens.
  const key = editing ? `${editing.person.key}|${editing.date}` : "closed";
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      {editing && <CellForm key={key} editing={editing} data={data} onSaved={onSaved} onClose={onClose} onCopy={onCopy} />}
    </Dialog>
  );
}

function CellForm({
  editing,
  data,
  onSaved,
  onClose,
  onCopy,
}: {
  editing: Editing;
  data: CrewBoardData;
  onSaved: () => void;
  onClose: () => void;
  onCopy: (cell: CrewCell) => void;
}) {
  const { person, date } = editing;
  const existing = data.cells[person.key]?.[date] ?? [];
  const owned = existing.find((c) => c.source === "board" && !c.shared);
  const pasteBlocked = !!editing.copied && existing.some((c) => !movable(c));
  const seed = editing.copied ?? owned ?? existing[0];
  const day = useMemo(
    () => data.weeks.flatMap((w) => w.days).find((d) => d.str === date) ?? null,
    [data.weeks, date],
  );

  const [projectId, setProjectId] = useState(seed?.projectId ?? "");
  const [scope, setScope] = useState(seed && seed.name !== seed.projectName ? seed.name : "");
  const [confirmed, setConfirmed] = useState(seed ? seed.confirmed : true);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);

  const save = () => {
    if (pasteBlocked) return;
    setError(null);
    startSaving(async () => {
      try {
      const res = await setCrewAssignment({
        personKind: person.kind,
        personId: person.id,
        date,
        projectId,
        scope,
        confirmed,
      });
      if (res.error) setError(res.error);
      else onSaved();
      } catch {
        setError("Couldn't confirm the save. Close and refresh the board before retrying.");
      }
    });
  };

  const remove = (cell: CrewCell) => {
    setError(null);
    setRemoving(cell.phaseId);
    startSaving(async () => {
      try {
      const res = await clearCrewAssignment({
        personKind: person.kind,
        personId: person.id,
        date,
        phaseId: cell.phaseId,
      });
      setRemoving(null);
      if (res.error) setError(res.error);
      else onSaved();
      } catch {
        setError("Couldn't confirm the removal. Close and refresh the board before retrying.");
      } finally {
        setRemoving(null);
      }
    });
  };

  const projectKnown = data.projects.some((p) => p.id === projectId);

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{person.name}</DialogTitle>
        <DialogDescription>
          {longDate(date)}
          {day?.holiday && ` · ${day.holiday.name}${day.holiday.closed ? " — closed" : ""}`}
          {day?.weather && ` · ${day.weather.icon} ${day.weather.high}°`}
          {day?.weather?.wet && " · wet"}
        </DialogDescription>
      </DialogHeader>

      {editing.copied && <p className="rounded-md bg-muted p-2 text-sm">
        Copying {editing.copied.projectName} to {person.name} on {longDate(date)}.
        {owned && " Saving replaces this person's existing board assignment for this day."}
      </p>}
      {pasteBlocked && <p role="alert" className="text-sm text-amber-500">
        This day includes a shared or project-schedule assignment. Choose another day to paste,
        or edit that assignment from its project.
      </p>}

      {existing.length > 0 && (
        <ul className="space-y-1.5">
          {existing.map((c) => (
            <li
              key={c.phaseId}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
            >
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: c.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.projectName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {c.name !== c.projectName ? c.name : "—"}
                  {!c.confirmed && " · proposed"}
                  {c.shared && " · with others"}
                  {c.source === "schedule" && " · from the job's schedule"}
                  {c.source === "sub" && " · the sub scheduled this"}
                  {c.startDate !== c.endDate && ` · ${c.startDate.slice(5)}→${c.endDate.slice(5)}`}
                </span>
              </span>
              <button type="button" onClick={() => onCopy(c)} disabled={saving || !c.projectId}
                className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                aria-label={`Copy ${c.projectName}`}>
                <Copy className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => remove(c)}
                disabled={saving}
                className="rounded p-1 text-muted-foreground hover:text-red-400 disabled:opacity-40"
                aria-label={`Take ${person.name} off ${c.projectName} this day`}
              >
                {removing === c.phaseId ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="crew-job">Job</Label>
          <JobPicker projects={data.projects} value={projectId} onChange={setProjectId} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="crew-scope">What they&apos;re doing</Label>
          <Input
            id="crew-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="Trim, demo, framing with John…"
            maxLength={120}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
          Confirmed — show it on their day
        </label>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !projectKnown || pasteBlocked}>
            {saving && !removing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {owned ? "Update" : "Assign"}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

// ── Job picker ───────────────────────────────────────────────────

const GROUPS: { key: CrewProjectOption["group"]; heading: string }[] = [
  { key: "running", heading: "On site — crew scheduled" },
  { key: "active", heading: "Active jobs" },
  { key: "contracted", heading: "Contracted — not started" },
];

/**
 * Type-to-filter over name and job number, with the running jobs first.
 *
 * The plain select this replaced put twenty-eight jobs in one alphabetical
 * list, so finding the three Jorge is actually moving people between meant
 * scrolling past the shop and the office.
 */
function JobPicker({
  projects,
  value,
  onChange,
}: {
  projects: CrewProjectOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = projects.find((p) => p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="crew-job"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: selected.color }}
              />
              <span className="truncate">{selected.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{selected.shortNumber}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Pick a job</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[300px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Type a job name or number…" />
          <CommandList className="max-h-[min(340px,55vh)]">
            <CommandEmpty>No job matches that.</CommandEmpty>
            {GROUPS.map(({ key, heading }) => {
              const rows = projects.filter((p) => p.group === key);
              if (rows.length === 0) return null;
              return (
                <CommandGroup key={key} heading={heading}>
                  {rows.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.name} ${p.projectNumber} ${p.shortNumber}`}
                      onSelect={() => {
                        onChange(p.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn("h-4 w-4 shrink-0", value === p.id ? "opacity-100" : "opacity-0")}
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {p.shortNumber}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Add a sub row ────────────────────────────────────────────────

function AddSubDialog({
  open,
  choices,
  onClose,
  onPick,
}: {
  open: boolean;
  choices: { id: string; name: string }[];
  onClose: () => void;
  onPick: (s: { id: string; name: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a sub to the board</DialogTitle>
          <DialogDescription>
            They get a row so you can schedule them by the day. The row sticks once they have work on it.
          </DialogDescription>
        </DialogHeader>
        <Command className="rounded-md border border-border">
          <CommandInput placeholder="Type a sub's name…" />
          <CommandList className="max-h-[min(320px,50vh)]">
            <CommandEmpty>No sub matches that.</CommandEmpty>
            <CommandGroup>
              {choices.map((s) => (
                <CommandItem key={s.id} value={s.name} onSelect={() => onPick(s)}>
                  <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{s.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
