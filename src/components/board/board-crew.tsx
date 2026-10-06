"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarOff,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eraser,
  Loader2,
  Lock,
  Plus,
  Search,
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
import { cn } from "@/lib/utils";
import {
  assignCrewCells,
  clearCrewCells,
  confirmCrewPhases,
  moveCrewAssignment,
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
import { CrewDayDialog } from "./crew-day-dialog";
import { JobPicker } from "./crew-job-picker";
import { clipFrom, longDate, movable, shortJob, type CrewClip } from "./crew-helpers";

/**
 * The crew board — people down the side, days across, as one continuous grid.
 *
 * Built for speed:
 *   drag a job from the tray onto a day          → they're on it
 *   drag across days / people, then pick a job   → the whole block is filled
 *   drag a chip to another day or person         → moved
 *   hold ⌥ / Ctrl while dropping                 → copied instead
 *   tap a day                                    → see it, edit it, add another
 *   double-click a chip (or hover + Ctrl/⌘C)     → copy it; every day you click
 *                                                  after that gets it pasted
 *   hover + Ctrl/⌘V, or a picked block + ⌘V      → paste there
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

  // Copy & paste
  const [clip, setClip] = useState<CrewClip | null>(null);
  /** The day under the mouse — Ctrl/⌘C copies from it, Ctrl/⌘V pastes into it. */
  const hoverRef = useRef<{ person: CrewPerson; date: string } | null>(null);
  /** A click on a chip waits a beat, in case it's the first half of a double-click. */
  const clickTimer = useRef<number | null>(null);

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

  // ── Copy & paste ───────────────────────────────────────────────

  const copyCell = useCallback((cell: CrewCell) => {
    const c = clipFrom(cell);
    if (!c) return;
    setClip(c);
    setEditing(null);
    setNotice(`Copied ${shortJob(c.projectName)} — click any day to paste it`);
  }, []);

  const closedDays = useMemo(
    () => new Set(data.weeks.flatMap((w) => w.days).filter((d) => d.holiday?.closed).map((d) => d.str)),
    [data.weeks],
  );

  const pasteTo = (all: { person: CrewPerson; date: string }[]) => {
    if (!clip || !all.length) return;
    // Never onto a day the company is shut.
    const targets = all.filter((t) => !closedDays.has(t.date));
    if (!targets.length) {
      setNotice("Closed that day — nothing pasted");
      return;
    }
    const project = projectById.get(clip.projectId);
    if (project) addPending(targets, () => optimisticChip(project, clip.scope || project.name, clip.confirmed));
    const cells = targets.map((t) => ({ personKind: t.person.kind, personId: t.person.id, date: t.date }));
    void run(
      () => assignCrewCells({ cells, projectId: clip.projectId, scope: clip.scope, confirmed: clip.confirmed }),
      targets.length === 1
        ? `${shortJob(clip.projectName)} → ${targets[0].person.name.split(" ")[0]}, ${longDate(targets[0].date)}`
        : `${shortJob(clip.projectName)} pasted on ${targets.length} days`,
    );
  };

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
  const onCellClick = (e: React.MouseEvent, person: CrewPerson, date: string) => {
    const skip = suppressClick.current;
    suppressClick.current = false;
    if (sel || skip) return; // a block was drawn or let go — don't also open the day
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = null;
    // The second click of a double-click: the chip's double-click handler
    // copies; nothing else should happen (no paste, no popup flash).
    if (e.detail > 1) return;
    // Every click waits a beat so a double-click can cancel it.
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      if (clip) pasteTo([{ person, date }]);
      else setEditing({ person, date });
    }, 230);
  };

  const onChipDoubleClick = (cell: CrewCell) => {
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = null;
    copyCell(cell);
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

  // Keyboard: Ctrl/⌘C copies the day under the mouse, Ctrl/⌘V pastes into a
  // picked block or the day under the mouse, Delete clears a block, Esc lets
  // go of the block and then of the copy.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (editing || addingSub) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "c" && hoverRef.current) {
        const h = hoverRef.current;
        const cells = cellsFor(h.person, h.date).filter((c) => !c.phaseId.startsWith("pending-"));
        const pick = cells.find(movable) ?? cells[0];
        if (pick) {
          e.preventDefault();
          copyCell(pick);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "v" && clip) {
        e.preventDefault();
        if (selected.size) {
          pasteTo(selectedRefs().targets);
          setSel(null);
        } else if (hoverRef.current) {
          pasteTo([hoverRef.current]);
        }
        return;
      }
      if (e.key === "Escape") {
        if (sel) setSel(null);
        else if (clip) setClip(null);
        return;
      }
      if (sel && (e.key === "Delete" || e.key === "Backspace")) {
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
        Double-click a chip to copy it, then click days to paste · drag a chip to move it (⌥/Ctrl to copy) · drag
        across days to pick a block · tap a day to open it · Ctrl/⌘C · Ctrl/⌘V · Delete clears a block
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
                        onMouseEnter={() => {
                          hoverRef.current = { person, date: d.str };
                          onCellMouseEnter({ p: pi, d: di });
                        }}
                        onMouseLeave={() => {
                          if (hoverRef.current?.person.key === person.key && hoverRef.current.date === d.str) {
                            hoverRef.current = null;
                          }
                        }}
                        onClick={(e) => onCellClick(e, person, d.str)}
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
                          !isSel && !isOver && (clip ? "cursor-copy hover:bg-primary/10 hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-primary/60" : "hover:bg-muted/50"),
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
                              onDoubleClick={() => onChipDoubleClick(c)}
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
            {clip && (
              <Button
                size="sm"
                className="h-8"
                variant="secondary"
                disabled={working}
                onClick={() => {
                  pasteTo(selectedRefs().targets);
                  setSel(null);
                }}
              >
                Paste {shortJob(clip.projectName)}
              </Button>
            )}
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

      {clip && (
        <div
          className={cn(
            "pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4",
            selected.size ? "bottom-20" : "bottom-5",
          )}
        >
          <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border border-primary/50 bg-popover px-3 py-2 text-sm shadow-xl">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: clip.color }} aria-hidden />
            <span className="min-w-0 truncate">
              <span className="font-medium">Pasting {shortJob(clip.projectName)}</span>
              {clip.scope && <span className="text-muted-foreground"> · {clip.scope}</span>}
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">click any day · Esc to stop</span>
            <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => setClip(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {notice && !selected.size && !clip && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <span className="pointer-events-auto rounded-lg border border-emerald-500/40 bg-emerald-950/90 px-3 py-1.5 text-xs text-emerald-200 shadow-lg">
            {notice}
          </span>
        </div>
      )}

      <CrewDayDialog
        editing={editing}
        data={data}
        showWeekends={showWeekends}
        confirmDefault={confirmNew}
        onNavigate={(date) => setEditing((prev) => (prev ? { ...prev, date } : prev))}
        onClose={() => setEditing(null)}
        onCopy={(c) => {
          setEditing(null);
          setClip(c);
          setNotice(`Copied ${shortJob(c.projectName)} — click any day to paste it`);
        }}
        onChanged={() => startRefresh(() => router.refresh())}
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
  onDoubleClick,
}: {
  cell: CrewCell;
  /** Alone in its day — room for the scope on a second line. */
  roomy: boolean;
  faded: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDoubleClick: () => void;
}) {
  const scope = cell.name !== cell.projectName ? cell.name : null;
  const pendingChip = cell.phaseId.startsWith("pending-");
  const origin =
    cell.source === "board" ? "" : cell.source === "sub" ? " · the sub scheduled this" : " · from the job's schedule";
  return (
    <span
      data-chip
      draggable={!pendingChip}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!pendingChip) onDoubleClick();
      }}
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
      }${origin}${movable(cell) ? " · drag to move, ⌥/Ctrl-drag to copy" : " · drag to copy"} · double-click to copy`}
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
