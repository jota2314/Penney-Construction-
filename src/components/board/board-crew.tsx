"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarOff,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  Eraser,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
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
  assignCrewCells,
  clearCrewAssignment,
  clearCrewCells,
  confirmCrewPhases,
  moveCrewAssignment,
  setCrewAssignment,
  type CrewCellRef,
} from "@/lib/actions/crew-board";
import type {
  CrewBoardData,
  CrewCell,
  CrewDay,
  CrewPerson,
  CrewProjectOption,
} from "@/lib/board/crew-board-data";
import type { ActualWork } from "@/lib/board/actual-work";

/**
 * The crew board — people down the side, days across, as one continuous grid.
 *
 * Built for speed:
 *   drag a job from the tray onto a day          → they're on it
 *   drag across days / people, then pick a job   → the whole block is filled
 *   drag a chip to another day or person         → moved
 *   hold ⌥ / Ctrl while dropping                 → copied instead
 *   tap a day                                    → see it, edit it, add another
 *
 * A person can carry two or three jobs on one day; each is its own chip.
 * Solid chips are confirmed and show on the worker's own /crew view; dashed
 * ones are proposed and stay here until "Confirm" is pressed.
 *
 * A chip that came from a job's master schedule carries a lock — it spans days
 * and people this grid can't see, so it can be copied but not moved here.
 */

const NAME_W = 168;
const DAY_MIN_W = 104;
const MAX_CHIPS = 3;

interface Props {
  data: CrewBoardData;
}

interface CellPos {
  p: number;
  d: number;
}

type DragPayload =
  | { kind: "chip"; cell: CrewCell; person: CrewPerson; date: string }
  | { kind: "job"; project: CrewProjectOption };

interface Pending {
  adds: Record<string, CrewCell[]>;
  hides: Set<string>;
}

const EMPTY_PENDING: Pending = { adds: {}, hides: new Set() };

function longDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** A chip moves only when this board owns it outright; everything else copies. */
function movable(cell: CrewCell) {
  return cell.source === "board" && !cell.shared;
}

/** "Jackling Project" → "Jackling": the generic tail costs a chip its name. */
function shortJob(name: string) {
  const cut = name.replace(/\s+(project|renovation|remodel|residence|reno)$/i, "").trim();
  return cut || name;
}

function cellKey(person: CrewPerson, date: string) {
  return `${person.key}|${date}`;
}

export function BoardCrew({ data }: Props) {
  const router = useRouter();
  const [pendingRefresh, startRefresh] = useTransition();

  // Keep the grid live: a minute's refresh while visible, and on return.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  const [weeksShown, setWeeksShown] = useState(2);
  const maxFrom = Math.max(0, data.weeks.length - weeksShown);
  const [from, setFrom] = useState(Math.min(data.thisWeekIndex, maxFrom));
  const [showWeekends, setShowWeekends] = useState(false);
  const [confirmNew, setConfirmNew] = useState(true);
  const [query, setQuery] = useState("");
  const [jobQuery, setJobQuery] = useState("");
  const [extraSubs, setExtraSubs] = useState<CrewPerson[]>([]);
  const [editing, setEditing] = useState<{ person: CrewPerson; date: string } | null>(null);
  const [addingSub, setAddingSub] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const [pending, setPending] = useState<Pending>(EMPTY_PENDING);
  const working = busy > 0 || pendingRefresh;

  // Drag-and-drop
  const dragRef = useRef<DragPayload | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [copyMode, setCopyMode] = useState(false);

  // Block selection
  const [sel, setSel] = useState<{ a: CellPos; b: CellPos } | null>(null);
  const selecting = useRef<{ a: CellPos; moved: boolean } | null>(null);
  /** The press that let go of a picked block shouldn't also open a day. */
  const suppressClick = useRef(false);
  const [blockJob, setBlockJob] = useState("");
  const [blockScope, setBlockScope] = useState("");

  // A fresh payload from the server replaces every optimistic chip.
  useEffect(() => {

    setPending(EMPTY_PENDING);
  }, [data]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const people = useMemo(() => {
    const seen = new Set(data.people.map((p) => p.key));
    return [...data.people, ...extraSubs.filter((p) => !seen.has(p.key))];
  }, [data.people, extraSubs]);

  const subChoices = useMemo(() => {
    const onBoard = new Set(people.filter((p) => p.kind === "sub").map((p) => p.id));
    return data.subs.filter((s) => !onBoard.has(s.id));
  }, [data.subs, people]);

  const visiblePeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((person) => `${person.name} ${person.title ?? ""}`.toLowerCase().includes(q));
  }, [people, query]);

  const weeks = data.weeks.slice(from, from + weeksShown);
  const days = useMemo(
    () => weeks.flatMap((w) => w.days).filter((d) => showWeekends || !d.isWeekend),
    [weeks, showWeekends],
  );
  const rangeLabel = weeks.length
    ? `${weeks[0].label}${weeks.length > 1 ? ` → ${weeks[weeks.length - 1].label}` : ""}`
    : "";

  const projectById = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
  const trayJobs = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    return data.projects.filter(
      (p) => !q || `${p.name} ${p.projectNumber} ${p.shortNumber}`.toLowerCase().includes(q),
    );
  }, [data.projects, jobQuery]);

  const cellsFor = useCallback(
    (person: CrewPerson, date: string) => {
      const base = (data.cells[person.key]?.[date] ?? []).filter(
        (c) => !pending.hides.has(`${c.phaseId}|${person.key}|${date}`),
      );
      return [...base, ...(pending.adds[cellKey(person, date)] ?? [])];
    },
    [data.cells, pending],
  );

  // The proposed rows on screen — exactly what "Confirm N" will confirm.
  const proposedIds = useMemo(() => {
    const seen = new Set<string>();
    for (const person of visiblePeople) {
      for (const d of days) {
        for (const c of data.cells[person.key]?.[d.str] ?? []) {
          if (c.source === "board" && !c.confirmed) seen.add(c.phaseId);
        }
      }
    }
    return Array.from(seen);
  }, [visiblePeople, days, data.cells]);

  // ── Running server work ────────────────────────────────────────

  const run = useCallback(
    async (work: () => Promise<{ error?: string | null }>, done?: string) => {
      setError(null);
      setBusy((n) => n + 1);
      try {
        const res = await work();
        if (res.error) {
          setError(res.error);
          setPending(EMPTY_PENDING);
        } else if (done) setNotice(done);
      } catch {
        setError("Couldn't confirm that change. Refresh the board before trying again.");
        setPending(EMPTY_PENDING);
      } finally {
        setBusy((n) => n - 1);
        startRefresh(() => router.refresh());
      }
    },
    [router],
  );

  const optimisticChip = (project: CrewProjectOption, name: string, confirmed: boolean): CrewCell => ({
    phaseId: `pending-${project.id}-${Math.random().toString(36).slice(2)}`,
    projectId: project.id,
    projectName: project.name,
    projectNumber: project.projectNumber,
    name,
    color: project.color,
    confirmed,
    source: "board",
    shared: false,
    status: "not_started",
    startDate: "",
    endDate: "",
  });

  const addPending = (targets: { person: CrewPerson; date: string }[], chip: () => CrewCell, hide?: string) =>
    setPending((prev) => {
      const adds = { ...prev.adds };
      for (const t of targets) {
        const k = cellKey(t.person, t.date);
        adds[k] = [...(adds[k] ?? []), chip()];
      }
      const hides = new Set(prev.hides);
      if (hide) hides.add(hide);
      return { adds, hides };
    });

  // ── Block selection ────────────────────────────────────────────

  const selected = useMemo(() => {
    if (!sel) return new Set<string>();
    const [p0, p1] = [Math.min(sel.a.p, sel.b.p), Math.max(sel.a.p, sel.b.p)];
    const [d0, d1] = [Math.min(sel.a.d, sel.b.d), Math.max(sel.a.d, sel.b.d)];
    const out = new Set<string>();
    for (let p = p0; p <= p1; p++) {
      for (let d = d0; d <= d1; d++) {
        const person = visiblePeople[p];
        const day = days[d];
        if (person && day && !day.holiday?.closed) out.add(cellKey(person, day.str));
      }
    }
    return out;
  }, [sel, visiblePeople, days]);

  const selectedRefs = useCallback((): { refs: CrewCellRef[]; targets: { person: CrewPerson; date: string }[] } => {
    const refs: CrewCellRef[] = [];
    const targets: { person: CrewPerson; date: string }[] = [];
    for (const person of visiblePeople) {
      for (const d of days) {
        if (!selected.has(cellKey(person, d.str))) continue;
        refs.push({ personKind: person.kind, personId: person.id, date: d.str });
        targets.push({ person, date: d.str });
      }
    }
    return { refs, targets };
  }, [selected, visiblePeople, days]);

  useEffect(() => {
    const up = () => {
      selecting.current = null;
      // The flag only guards the click this very press produces (it fires
      // before this timeout); a press that ends elsewhere mustn't leave it
      // set to swallow the next chip click.
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const onCellMouseDown = (e: React.MouseEvent, pos: CellPos) => {
    if (e.button !== 0) return;
    suppressClick.current = !!sel;
    if (e.shiftKey && sel) {
      setSel({ a: sel.a, b: pos });
      return;
    }
    selecting.current = { a: pos, moved: false };
    setSel(null);
  };
  const onCellMouseEnter = (pos: CellPos) => {
    const s = selecting.current;
    if (!s) return;
    if (s.a.p !== pos.p || s.a.d !== pos.d) s.moved = true;
    if (s.moved) setSel({ a: s.a, b: pos });
  };
  const onCellClick = (person: CrewPerson, date: string) => {
    const skip = suppressClick.current;
    suppressClick.current = false;
    if (sel || skip) return; // a block was drawn or let go — don't also open the day
    setEditing({ person, date });
  };

  const assignBlock = (projectId: string, scope: string) => {
    const project = projectById.get(projectId);
    const { refs, targets } = selectedRefs();
    if (!project || !refs.length) return;
    addPending(targets, () => optimisticChip(project, scope.trim() || project.name, confirmNew));
    setSel(null);
    setBlockScope("");
    void run(
      () => assignCrewCells({ cells: refs, projectId, scope, confirmed: confirmNew }),
      `${project.name} on ${refs.length} day${refs.length === 1 ? "" : "s"}`,
    );
  };

  const clearBlock = () => {
    const { refs, targets } = selectedRefs();
    if (!refs.length) return;
    setPending((prev) => {
      const hides = new Set(prev.hides);
      for (const t of targets) {
        for (const c of data.cells[t.person.key]?.[t.date] ?? []) {
          if (c.source === "board") hides.add(`${c.phaseId}|${t.person.key}|${t.date}`);
        }
      }
      return { ...prev, hides };
    });
    setSel(null);
    void run(() => clearCrewCells({ cells: refs }), `Cleared ${refs.length} day${refs.length === 1 ? "" : "s"}`);
  };

  // Keyboard on the block: Delete clears it, Esc lets go.
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") setSel(null);
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        clearBlock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Drag and drop ──────────────────────────────────────────────

  const beginDrag = (e: React.DragEvent, payload: DragPayload) => {
    e.stopPropagation();
    // Until the last move lands, chips may still point at rows it reshaped.
    if (payload.kind === "chip" && working) {
      e.preventDefault();
      return;
    }
    // Firefox refuses to start a drag without data on the transfer.
    e.dataTransfer.setData("text/plain", payload.kind === "job" ? payload.project.name : payload.cell.projectName);
    e.dataTransfer.effectAllowed = "copyMove";
    dragRef.current = payload;
    setDragging(payload);
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(null);
    setOver(null);
    setCopyMode(false);
  };

  const dropOn = (e: React.DragEvent, person: CrewPerson, date: string) => {
    e.preventDefault();
    const payload = dragRef.current;
    const wantsCopy = e.altKey || e.ctrlKey || e.metaKey;
    endDrag();
    if (!payload) return;
    const key = cellKey(person, date);

    if (payload.kind === "job") {
      // Dropped on a picked block → fill the block. Otherwise just this day.
      if (selected.has(key) && selected.size > 1) {
        assignBlock(payload.project.id, "");
        return;
      }
      addPending([{ person, date }], () => optimisticChip(payload.project, payload.project.name, confirmNew));
      void run(
        () =>
          assignCrewCells({
            cells: [{ personKind: person.kind, personId: person.id, date }],
            projectId: payload.project.id,
            confirmed: confirmNew,
          }),
        `${person.name.split(" ")[0]} → ${payload.project.name}, ${longDate(date)}`,
      );
      return;
    }

    const { cell, person: fromPerson, date: fromDate } = payload;
    if (fromPerson.key === person.key && fromDate === date) return;
    if (!cell.projectId) return;
    const copy = wantsCopy || !movable(cell);
    const project = projectById.get(cell.projectId);
    if (project) {
      addPending(
        [{ person, date }],
        () => optimisticChip(project, cell.name, cell.confirmed),
        copy ? undefined : `${cell.phaseId}|${fromPerson.key}|${fromDate}`,
      );
    }
    void run(
      () =>
        moveCrewAssignment({
          phaseId: cell.phaseId,
          fromKind: fromPerson.kind,
          fromId: fromPerson.id,
          fromDate,
          toKind: person.kind,
          toId: person.id,
          toDate: date,
          copy,
        }),
      copy ? `Copied ${cell.projectName}` : `Moved ${cell.projectName}`,
    );
  };

  const confirmAll = () => {
    if (!proposedIds.length) return;
    void run(async () => {
      const res = await confirmCrewPhases({ phaseIds: proposedIds });
      if (!res.error) setNotice(`Confirmed ${res.count} — the crew can see them now`);
      return res;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Find crew"
            placeholder="Find crew…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-36 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setFrom((f) => Math.max(0, f - 1))} disabled={from === 0} aria-label="Earlier week">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setFrom(Math.min(data.thisWeekIndex, maxFrom))}
            disabled={from === Math.min(data.thisWeekIndex, maxFrom)}
          >
            This week
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setFrom((f) => Math.min(maxFrom, f + 1))} disabled={from >= maxFrom} aria-label="Later week">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Weeks to show">
          {[1, 2, 4].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={weeksShown === n}
              onClick={() => {
                setWeeksShown(n);
                setFrom((f) => Math.min(f, Math.max(0, data.weeks.length - n)));
              }}
              className={cn(
                "rounded px-2 py-1 text-xs",
                weeksShown === n ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {n} wk{n > 1 ? "s" : ""}
            </button>
          ))}
        </div>
        <span className="px-1 text-xs font-medium text-muted-foreground">{rangeLabel}</span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={showWeekends} onCheckedChange={(v) => setShowWeekends(v === true)} aria-label="Show weekends" />
          Weekends
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="New assignments show on the worker's /crew right away when this is on">
          <Checkbox checked={confirmNew} onCheckedChange={(v) => setConfirmNew(v === true)} aria-label="Confirm new assignments" />
          Confirm as I assign
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          {working && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Saving
            </span>
          )}
          {proposedIds.length > 0 && (
            <Button variant="outline" size="sm" className="h-8 border-amber-500/50 text-amber-500" onClick={confirmAll} disabled={working}>
              <CheckCheck className="mr-1 h-3.5 w-3.5" aria-hidden />
              Confirm {proposedIds.length} proposed
            </Button>
          )}
          {subChoices.length > 0 && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => setAddingSub(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              Add sub
            </Button>
          )}
        </div>
      </div>

      {/* ── Job tray ── */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Drag a job onto a day
        </span>
        <Input
          aria-label="Filter jobs"
          placeholder="Filter…"
          value={jobQuery}
          onChange={(e) => setJobQuery(e.target.value)}
          className="h-7 w-24 shrink-0 text-xs"
        />
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
          {trayJobs.map((p) => (
            <button
              key={p.id}
              type="button"
              draggable
              onDragStart={(e) => beginDrag(e, { kind: "job", project: p })}
              onDragEnd={endDrag}
              onClick={() => {
                if (selected.size) assignBlock(p.id, blockScope);
              }}
              title={
                selected.size
                  ? `Put ${p.name} on the ${selected.size} picked day${selected.size === 1 ? "" : "s"}`
                  : `Drag ${p.name} onto a day`
              }
              className={cn(
                "flex shrink-0 cursor-grab items-center gap-1.5 rounded-md border px-2 py-1 text-xs active:cursor-grabbing",
                p.group === "contracted" ? "border-dashed border-border text-muted-foreground" : "border-border",
                selected.size > 0 && "hover:border-primary hover:text-primary",
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden />
              <span className="max-w-[150px] truncate">{p.name}</span>
              <span className="tabular-nums text-[10px] text-muted-foreground">{p.shortNumber}</span>
            </button>
          ))}
          {trayJobs.length === 0 && <span className="text-xs text-muted-foreground">No job matches.</span>}
        </div>
      </div>

      <p className="hidden text-[11px] text-muted-foreground lg:block">
        Drag across days or people to pick a block, then tap a job above · drag a chip to move it, hold ⌥/Ctrl to copy ·
        tap a day to edit or add a second job · Delete clears a picked block
      </p>

      {error && (
        <p className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-400">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="ml-auto">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </p>
      )}

      {/* ── Grid ── */}
      <div className="min-h-0 flex-1 select-none overflow-auto rounded-lg border border-border bg-card">
        {visiblePeople.length === 0 ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            No crew match your search.
          </p>
        ) : (
          <table
            className="w-full table-fixed border-separate border-spacing-0 text-sm"
            style={{ minWidth: NAME_W + days.length * DAY_MIN_W }}
          >
            <thead>
              <tr>
                <th
                  className="sticky left-0 top-0 z-30 border-b border-border bg-card px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
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
              {visiblePeople.map((person, pi) => (
                <tr key={person.key}>
                  <td
                    className="sticky left-0 z-10 border-b border-border bg-card px-3 py-1.5 align-middle"
                    style={{ width: NAME_W, minWidth: NAME_W }}
                  >
                    <div className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
                      {person.kind === "sub" && <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                      <span className="truncate">{person.name}</span>
                    </div>
                    {person.title && <div className="truncate text-[10px] text-muted-foreground">{person.title}</div>}
                  </td>
                  {days.map((d, di) => {
                    const key = cellKey(person, d.str);
                    const cells = cellsFor(person, d.str);
                    const actual = data.actualWork?.[person.key]?.[d.str] ?? [];
                    const isSel = selected.has(key);
                    const isOver = over === key && !!dragging;
                    const monday = new Date(`${d.str}T12:00:00`).getDay() === 1;
                    return (
                      <td
                        key={d.str}
                        onMouseDown={(e) => onCellMouseDown(e, { p: pi, d: di })}
                        onMouseEnter={() => onCellMouseEnter({ p: pi, d: di })}
                        onClick={() => onCellClick(person, d.str)}
                        onDragOver={(e) => {
                          if (!dragRef.current) return;
                          e.preventDefault();
                          const copy =
                            e.altKey || e.ctrlKey || e.metaKey ||
                            (dragRef.current.kind === "chip" && !movable(dragRef.current.cell)) ||
                            dragRef.current.kind === "job";
                          e.dataTransfer.dropEffect = copy ? "copy" : "move";
                          if (over !== key) setOver(key);
                          if (copy !== copyMode) setCopyMode(copy);
                        }}
                        onDragLeave={() => setOver((o) => (o === key ? null : o))}
                        onDrop={(e) => dropOn(e, person, d.str)}
                        className={cn(
                          "relative h-[54px] cursor-cell border-b border-l border-border/70 p-1 align-top transition-colors",
                          monday && "border-l-border",
                          d.isPast && "bg-muted/30",
                          d.isToday && "bg-amber-500/[0.06]",
                          d.isWeekend && "bg-muted/40",
                          d.holiday?.closed && "bg-red-500/[0.07]",
                          isSel && "bg-primary/15 outline outline-1 -outline-offset-1 outline-primary/60",
                          isOver && "bg-primary/20 outline outline-2 -outline-offset-2 outline-primary",
                          !isSel && !isOver && "hover:bg-muted/50",
                        )}
                        aria-label={`${person.name}, ${longDate(d.str)}`}
                      >
                        <div className="flex flex-col gap-0.5">
                          {cells.length === 0 && d.holiday?.closed && (
                            <span className="text-[10px] text-red-400/70">{d.holiday.name}</span>
                          )}
                          {cells.slice(0, MAX_CHIPS).map((c) => (
                            <Chip
                              key={c.phaseId}
                              cell={c}
                              roomy={cells.length === 1}
                              faded={dragging?.kind === "chip" && dragging.cell.phaseId === c.phaseId && dragging.date === d.str && !copyMode}
                              onDragStart={(e) => beginDrag(e, { kind: "chip", cell: c, person, date: d.str })}
                              onDragEnd={endDrag}
                            />
                          ))}
                          {cells.length > MAX_CHIPS && (
                            <span className="text-[10px] text-muted-foreground">+{cells.length - MAX_CHIPS} more</span>
                          )}
                        </div>
                        {(actual.length > 0 || (data.actualWorkUnavailable && d.isToday)) && (
                          <ActualMark work={actual} unavailable={data.actualWorkUnavailable && d.isToday} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Block bar ── */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-popover px-3 py-2 text-sm shadow-xl">
            <span className="font-medium">
              {selected.size} day{selected.size === 1 ? "" : "s"} picked
            </span>
            <div className="w-56">
              <JobPicker projects={data.projects} value={blockJob} onChange={setBlockJob} compact />
            </div>
            <Input
              value={blockScope}
              onChange={(e) => setBlockScope(e.target.value)}
              placeholder="What they're doing (optional)"
              maxLength={120}
              className="h-8 w-52 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && blockJob) assignBlock(blockJob, blockScope);
              }}
            />
            <Button size="sm" className="h-8" disabled={!blockJob || working} onClick={() => assignBlock(blockJob, blockScope)}>
              Assign
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={clearBlock} disabled={working}>
              <Eraser className="mr-1 h-3.5 w-3.5" aria-hidden />
              Clear days
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setSel(null)} aria-label="Let go of the picked days">
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {notice && !selected.size && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <span className="pointer-events-auto rounded-lg border border-emerald-500/40 bg-emerald-950/90 px-3 py-1.5 text-xs text-emerald-200 shadow-lg">
            {notice}
          </span>
        </div>
      )}

      <DayEditor
        editing={editing}
        data={data}
        confirmDefault={confirmNew}
        onClose={() => setEditing(null)}
        onSaved={() => startRefresh(() => router.refresh())}
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

// ── Day header: date, holiday, forecast ──────────────────────────

function DayHead({ day }: { day: CrewDay }) {
  const w = day.weather;
  const closed = day.holiday?.closed;
  const monday = new Date(`${day.str}T12:00:00`).getDay() === 1;
  return (
    <th
      className={cn(
        "sticky top-0 z-20 border-b border-l border-border/70 bg-card px-1.5 py-1.5 text-left align-top text-[11px] font-semibold",
        monday && "border-l-border",
        day.isToday ? "text-primary" : "text-foreground",
        closed && "text-red-400",
      )}
      style={{ minWidth: DAY_MIN_W }}
    >
      <div className="flex items-baseline gap-1">
        <span className="uppercase tracking-wide">{day.dayName}</span>
        <span className="tabular-nums">{day.label}</span>
        {day.isToday && <span className="rounded bg-primary/20 px-1 text-[9px] uppercase">today</span>}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        {w && (
          <span
            className={cn("tabular-nums", w.wet && "text-sky-400")}
            title={`${w.label} · high ${w.high}° low ${w.low}° · rain ${w.precipChance}% · wind ${w.windMax} mph`}
          >
            {w.icon} {w.high}°{w.precipChance >= 30 ? ` ${w.precipChance}%` : ""}
          </span>
        )}
        {day.holiday && (
          <span className={cn("flex items-center gap-0.5 truncate", closed ? "text-red-400" : "text-muted-foreground/70")}>
            {closed && <CalendarOff className="h-2.5 w-2.5 shrink-0" aria-hidden />}
            {day.holiday.name}
          </span>
        )}
      </div>
    </th>
  );
}

// ── Chip ─────────────────────────────────────────────────────────

function Chip({
  cell,
  roomy,
  faded,
  onDragStart,
  onDragEnd,
}: {
  cell: CrewCell;
  /** Alone in its day — room for the scope on a second line. */
  roomy: boolean;
  faded: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const scope = cell.name !== cell.projectName ? cell.name : null;
  const pendingChip = cell.phaseId.startsWith("pending-");
  const origin =
    cell.source === "board" ? "" : cell.source === "sub" ? " · the sub scheduled this" : " · from the job's schedule";
  return (
    <span
      draggable={!pendingChip}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "flex w-full flex-col justify-center overflow-hidden rounded px-1.5 text-[11px] leading-tight text-foreground",
        roomy && scope ? "min-h-[38px] py-0.5" : "h-5",
        faded && "opacity-30",
        pendingChip ? "animate-pulse cursor-wait" : "cursor-grab active:cursor-grabbing",
      )}
      style={{
        backgroundColor: `${cell.color}2e`,
        borderLeft: `3px solid ${cell.color}`,
        outline: cell.confirmed ? "none" : `1px dashed ${cell.color}`,
        outlineOffset: -1,
      }}
      title={`${cell.projectName}${scope ? ` — ${scope}` : ""}${cell.confirmed ? "" : " (proposed)"}${
        cell.shared ? " · with others" : ""
      }${origin}${movable(cell) ? " · drag to move, ⌥/Ctrl-drag to copy" : " · drag to copy"}`}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-medium">{shortJob(cell.projectName)}</span>
        {cell.source === "schedule" && <Lock className="ml-auto h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden />}
        {cell.source === "sub" && <Clock className="ml-auto h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden />}
      </span>
      {roomy && scope && <span className="line-clamp-2 text-[10px] text-foreground/65">{scope}</span>}
    </span>
  );
}

/** Corner mark for what really happened: worked, on the clock, or off-plan. */
function ActualMark({ work, unavailable }: { work: ActualWork[]; unavailable: boolean }) {
  if (unavailable && !work.length) {
    return (
      <span className="absolute right-1 top-1 text-[9px] text-amber-500" title="Time logs unavailable">
        ?
      </span>
    );
  }
  const live = work.some((w) => w.clockedIn);
  const off = work.some((w) => w.differsFromPlan);
  const tip = work
    .map(
      (w) =>
        `${w.clockedIn ? "On the clock" : "Worked"}: ${w.projectName}${w.task ? ` — ${w.task}` : ""}${
          w.differsFromPlan ? " (not what was planned)" : ""
        }${w.notes ? `\n${w.notes}` : ""}`,
    )
    .join("\n\n");
  return (
    <span
      className={cn(
        "absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-bold",
        off ? "bg-amber-500/25 text-amber-400" : "bg-emerald-500/25 text-emerald-400",
      )}
      title={tip}
    >
      {live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden /> : off ? "≠" : <Check className="h-2.5 w-2.5" aria-hidden />}
    </span>
  );
}

// ── Day editor ───────────────────────────────────────────────────

function DayEditor({
  editing,
  data,
  confirmDefault,
  onClose,
  onSaved,
}: {
  editing: { person: CrewPerson; date: string } | null;
  data: CrewBoardData;
  confirmDefault: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const key = editing ? `${editing.person.key}|${editing.date}` : "closed";
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      {editing && (
        <DayForm key={key} editing={editing} data={data} confirmDefault={confirmDefault} onSaved={onSaved} onClose={onClose} />
      )}
    </Dialog>
  );
}

function DayForm({
  editing,
  data,
  confirmDefault,
  onSaved,
  onClose,
}: {
  editing: { person: CrewPerson; date: string };
  data: CrewBoardData;
  confirmDefault: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { person, date } = editing;
  const existing = data.cells[person.key]?.[date] ?? [];
  const actual = data.actualWork?.[person.key]?.[date] ?? [];
  const day = useMemo(() => data.weeks.flatMap((w) => w.days).find((d) => d.str === date) ?? null, [data.weeks, date]);

  // Editing one chip, or adding a new one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingCell = existing.find((c) => c.phaseId === editingId) ?? null;
  const [projectId, setProjectId] = useState("");
  const [scope, setScope] = useState("");
  const [confirmed, setConfirmed] = useState(confirmDefault);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);

  const startEdit = (c: CrewCell) => {
    setEditingId(c.phaseId);
    setProjectId(c.projectId ?? "");
    setScope(c.name !== c.projectName ? c.name : "");
    setConfirmed(c.confirmed);
  };
  const startAdd = () => {
    setEditingId(null);
    setProjectId("");
    setScope("");
    setConfirmed(confirmDefault);
  };

  const save = () => {
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
          replacePhaseId: editingCell && movable(editingCell) ? editingCell.phaseId : undefined,
        });
        if (res.error) setError(res.error);
        else {
          onSaved();
          onClose();
        }
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
        const res = await clearCrewAssignment({ personKind: person.kind, personId: person.id, date, phaseId: cell.phaseId });
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

      {existing.length > 0 && (
        <ul className="space-y-1.5">
          {existing.map((c) => (
            <li
              key={c.phaseId}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
                editingId === c.phaseId ? "border-primary" : "border-border",
              )}
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
              {movable(c) && (
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  disabled={saving}
                  className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                  aria-label={`Edit ${c.projectName}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(c)}
                disabled={saving}
                className="rounded p-1 text-muted-foreground hover:text-red-400 disabled:opacity-40"
                aria-label={
                  c.source === "schedule"
                    ? `Take ${person.name} off the whole ${c.name} step on ${c.projectName}`
                    : `Take ${person.name} off ${c.projectName} this day`
                }
                title={
                  c.source === "schedule"
                    ? "Takes them off every day of this step — it comes from the job's schedule"
                    : "Take them off this day"
                }
              >
                {removing === c.phaseId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {actual.length > 0 && (
        <div className="space-y-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-500">Actual work · from time logs</p>
          {actual.map((w, i) => (
            <p key={i} className="text-xs">
              <span className="font-medium">
                {w.clockedIn ? "On the clock: " : "Worked: "}
                {w.projectName}
              </span>
              {w.task && <span className="text-muted-foreground"> — {w.task}</span>}
              {w.differsFromPlan && <span className="text-amber-500"> · not what was planned</span>}
              {w.notes && <span className="mt-0.5 block whitespace-pre-wrap text-muted-foreground line-clamp-3">{w.notes}</span>}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-3 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{editingCell ? `Change ${editingCell.projectName}` : existing.length ? "Add another job this day" : "Put them on a job"}</p>
          {editingCell && (
            <button type="button" onClick={startAdd} className="text-xs text-muted-foreground hover:text-foreground">
              Add a new one instead
            </button>
          )}
        </div>
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && projectKnown) save();
            }}
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
          <Button size="sm" onClick={save} disabled={saving || !projectKnown}>
            {saving && !removing && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
            {editingCell ? "Save" : "Add"}
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

/** Type-to-filter over name and job number, with the running jobs first. */
function JobPicker({
  projects,
  value,
  onChange,
  compact,
}: {
  projects: CrewProjectOption[];
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = projects.find((p) => p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={compact ? undefined : "crew-job"}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", compact && "h-8 text-xs")}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: selected.color }} />
              <span className="truncate">{selected.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{selected.shortNumber}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Pick a job</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[300px] p-0" align="start">
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
                      <Check className={cn("h-4 w-4 shrink-0", value === p.id ? "opacity-100" : "opacity-0")} />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{p.shortNumber}</span>
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
