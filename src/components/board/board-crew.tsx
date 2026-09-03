"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock, Loader2, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clearCrewAssignment, setCrewAssignment } from "@/lib/actions/crew-board";
import type { CrewBoardData, CrewCell, CrewPerson } from "@/lib/board/crew-board-data";

/**
 * The crew board — people down the side, days across, one week per block.
 *
 * Built to match the way Jorge already plans: tap a day, say which job and
 * what they're doing, done. Solid chips are confirmed and show up on the
 * crew's own /crew view; dashed ones are proposed and stay here. A clock
 * icon marks a row the crew created themselves by clocking in — it's on the
 * board because it happened, and the editor won't reshape it.
 */

const WEEKS_SHOWN = 4;
const NAME_W = 168;
const DAY_MIN_W = 132;

interface Props {
  data: CrewBoardData;
}

interface Editing {
  person: CrewPerson;
  date: string;
}

function longDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function BoardCrew({ data }: Props) {
  const router = useRouter();
  const maxFrom = Math.max(0, data.weeks.length - WEEKS_SHOWN);
  const [from, setFrom] = useState(Math.min(data.thisWeekIndex, maxFrom));
  const [showWeekends, setShowWeekends] = useState(false);
  const [extraSubs, setExtraSubs] = useState<CrewPerson[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [addingSub, setAddingSub] = useState(false);

  const people = useMemo(() => {
    const seen = new Set(data.people.map((p) => p.key));
    return [...data.people, ...extraSubs.filter((p) => !seen.has(p.key))];
  }, [data.people, extraSubs]);

  const subChoices = useMemo(() => {
    const onBoard = new Set(people.filter((p) => p.kind === "sub").map((p) => p.id));
    return data.subs.filter((s) => !onBoard.has(s.id));
  }, [data.subs, people]);

  const weeks = data.weeks.slice(from, from + WEEKS_SHOWN);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
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
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-foreground/70" /> confirmed — crew see it
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-foreground/60" /> proposed
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden /> clocked in by the crew
          </span>
          {subChoices.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setAddingSub(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              Add sub
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto pb-4">
        {weeks.map((week) => {
          const days = week.days.filter((d) => showWeekends || !d.isWeekend);
          return (
            <section key={week.start} className="rounded-lg border border-border bg-card">
              <h3 className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Week of {week.label}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" style={{ minWidth: NAME_W + days.length * DAY_MIN_W }}>
                  <thead>
                    <tr>
                      <th
                        className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                        style={{ width: NAME_W, minWidth: NAME_W }}
                      >
                        Crew
                      </th>
                      {days.map((d) => (
                        <th
                          key={d.str}
                          className={`border-l border-border px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider ${
                            d.isToday ? "text-amber-400" : "text-muted-foreground"
                          }`}
                          style={{ minWidth: DAY_MIN_W }}
                        >
                          {d.dayName} {d.label}
                          {d.isToday && " · today"}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => (
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
                          const cells = data.cells[person.key]?.[d.str] ?? [];
                          return (
                            <td
                              key={d.str}
                              className={`border-l border-border p-0 align-top ${
                                d.isPast ? "bg-muted/40" : ""
                              } ${d.isToday ? "bg-amber-500/5" : ""}`}
                            >
                              <button
                                type="button"
                                onClick={() => setEditing({ person, date: d.str })}
                                className="flex min-h-[64px] w-full flex-col gap-1 px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
                                aria-label={`${person.name}, ${longDate(d.str)}`}
                              >
                                {cells.length === 0 ? (
                                  <span className="text-xs text-muted-foreground/50">—</span>
                                ) : (
                                  cells.map((c) => <Chip key={c.phaseId} cell={c} dim={d.isPast} />)
                                )}
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
          setExtraSubs((prev) => [...prev, { key: `sub:${s.id}`, kind: "sub", id: s.id, name: s.name, title: "Sub" }]);
          setAddingSub(false);
        }}
      />
    </div>
  );
}

function Chip({ cell, dim }: { cell: CrewCell; dim: boolean }) {
  const scope = cell.name !== cell.projectName ? cell.name : null;
  return (
    <span
      className={`block w-full rounded px-1.5 py-1 text-xs leading-tight ${dim ? "opacity-60" : ""}`}
      style={{
        backgroundColor: `${cell.color}26`,
        borderLeft: `3px solid ${cell.color}`,
        outline: cell.confirmed ? "none" : `1px dashed ${cell.color}`,
        outlineOffset: -1,
      }}
      title={`${cell.projectName}${scope ? ` — ${scope}` : ""}${cell.confirmed ? "" : " (proposed)"}${
        cell.boardOwned ? "" : " · clocked in"
      }`}
    >
      <span className="flex items-center gap-1 font-medium">
        <span className="truncate">{cell.projectName}</span>
        {!cell.boardOwned && <Clock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />}
      </span>
      {scope && <span className="block truncate text-[11px] text-muted-foreground">{scope}</span>}
    </span>
  );
}

// ── Editor ───────────────────────────────────────────────────────

function CellEditor({
  editing,
  data,
  onClose,
  onSaved,
}: {
  editing: Editing | null;
  data: CrewBoardData;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Keyed on the cell so the form resets every time a different day opens.
  const key = editing ? `${editing.person.key}|${editing.date}` : "closed";
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      {editing && <CellForm key={key} editing={editing} data={data} onSaved={onSaved} />}
    </Dialog>
  );
}

function CellForm({
  editing,
  data,
  onSaved,
}: {
  editing: Editing;
  data: CrewBoardData;
  onSaved: () => void;
}) {
  const { person, date } = editing;
  const existing = data.cells[person.key]?.[date] ?? [];
  const owned = existing.find((c) => c.boardOwned && !c.shared);
  const seed = owned ?? existing[0];

  const [projectId, setProjectId] = useState(seed?.projectId ?? "");
  const [scope, setScope] = useState(seed && seed.name !== seed.projectName ? seed.name : "");
  const [confirmed, setConfirmed] = useState(seed ? seed.confirmed : true);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startSaving(async () => {
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
    });
  };

  const remove = (cell: CrewCell) => {
    setError(null);
    setRemoving(cell.phaseId);
    startSaving(async () => {
      const res = await clearCrewAssignment({
        personKind: person.kind,
        personId: person.id,
        date,
        phaseId: cell.phaseId,
      });
      setRemoving(null);
      if (res.error) setError(res.error);
      else onSaved();
    });
  };

  const projectKnown = data.projects.some((p) => p.id === projectId);

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{person.name}</DialogTitle>
        <DialogDescription>{longDate(date)}</DialogDescription>
      </DialogHeader>

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
                  {!c.boardOwned && " · clocked in"}
                  {c.startDate !== c.endDate && ` · ${c.startDate.slice(5)}→${c.endDate.slice(5)}`}
                </span>
              </span>
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
          <Select value={projectKnown ? projectId : ""} onValueChange={setProjectId}>
            <SelectTrigger id="crew-job" className="w-full">
              <SelectValue placeholder="Pick a job" />
            </SelectTrigger>
            <SelectContent>
              {data.projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
                    {p.name}
                    <span className="text-xs text-muted-foreground">{p.projectNumber.replace(/^PC-\d{4}-/, "")}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Button variant="outline" size="sm" onClick={() => onSaved()} disabled={saving}>
            Close
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !projectKnown}>
            {saving && !removing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {owned ? "Update" : "Assign"}
          </Button>
        </div>
      </div>
    </DialogContent>
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
  const [picked, setPicked] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a sub to the board</DialogTitle>
          <DialogDescription>
            They get a row so you can schedule them by the day. The row sticks once they have work on it.
          </DialogDescription>
        </DialogHeader>
        <Select value={picked} onValueChange={setPicked}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick a sub" />
          </SelectTrigger>
          <SelectContent>
            {choices.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!picked}
            onClick={() => {
              const s = choices.find((c) => c.id === picked);
              if (s) onPick(s);
              setPicked("");
            }}
          >
            Add row
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
