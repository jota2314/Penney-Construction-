"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  GanttChartSquare,
  Info,
  List,
  ListPlus,
  Loader2,
  Monitor,
  Plus,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardBar, BoardData, BoardJob } from "@/lib/board/board-data";
import { BoardJobSchedule } from "./board-job-schedule";
import type { CrewBoardData } from "@/lib/board/crew-board-data";
import { moveBoardPhases } from "@/lib/actions/board";
import { ScheduleQuickAddSheet } from "@/components/schedule/schedule-quick-add-sheet";
import { BoardTimeline, shiftDate, type BarMove, type MoveOptions, type TimelineControl } from "./board-timeline";
import { BoardTv } from "./board-tv";
import { BoardCrew } from "./board-crew";
import { BoardDrawer } from "./board-drawer";
import { BoardList, firstName } from "./board-list";
import { BoardUpdateSheet } from "./board-update-sheet";
import { BoardPhasePanel } from "./board-phase-panel";
import { SubsNeededChip } from "./subs-needed-sheet";
import { SubsTodayStrip } from "./subs-today-strip";

/**
 * The job board — the one schedule. (/schedule redirects here since 10/5.)
 *
 * JOBS  a card per job with one status and its next two weeks drawn (all
 *       a phone gets), or the full Gantt: every step, drag to move.
 * CREW  people down the side, days across; drop a job on a day, drag across
 *       days to fill a week, two or three jobs a day when that's the day.
 * WALL  the TV in the shop.
 *
 * Jobs and Wall read the same server payload; Crew reads the same
 * `schedule_phases` rows sideways. Moves are applied optimistically here and
 * written through `moveBoardPhases`, then reconciled by a refresh.
 */

export interface ProjectHealth {
  id: string;
  health: "green" | "yellow" | "red";
  note: string;
  issues: string[];
}

const HEALTH_CACHE_KEY = "job-board-health-v3";
const HEALTH_CACHE_TTL_MS = 30 * 60 * 1000;
const MODE_KEY = "job-board-mode";
const RANGE_KEY = "job-board-range";
const EXPANDED_KEY = "job-board-expanded";
const VIEW_KEY = "job-board-view";
const PM_KEY = "job-board-pm";
const TV_REFRESH_MS = 5 * 60 * 1000;

type Mode = "jobs" | "crew" | "tv";
/** Inside Jobs: a card per job, or the full Gantt. A phone only gets the cards. */
type JobsView = "list" | "timeline";

const NARROW_QUERY = "(max-width: 639px)";
function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const RANGES = [
  { days: 14, label: "2 wks" },
  { days: 28, label: "4 wks" },
  { days: 56, label: "8 wks" },
  { days: 91, label: "3 mo" },
] as const;

interface PhaseOverride {
  startDate?: string;
  endDate?: string;
  assignedEmployeeIds?: string[];
  assignedSubIds?: string[];
  /** Which move wrote these dates — a failed move only takes back its own. */
  seq?: number;
}

function daysBetween(a: string, b: string) {
  return Math.round(
    (new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000,
  );
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing — the preference just won't stick.
  }
}

export function JobBoard({
  data,
  crew,
  viewerId,
}: {
  data: BoardData;
  crew: CrewBoardData;
  /** The signed-in profile: a PM opens the board on their own jobs. */
  viewerId?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("jobs");
  const [jobsView, setJobsView] = useState<JobsView>("list");
  /** "all", "none" (no PM assigned) or a PM's profile id. */
  const [pm, setPm] = useState<string>("all");
  /** The job whose Update sheet is open. */
  const [updating, setUpdating] = useState<string | null>(null);
  /** The job whose whole schedule is on screen instead of the cards. */
  const [focusJob, setFocusJob] = useState<string | null>(null);
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
  const [visibleDays, setVisibleDays] = useState<number>(28);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [openPhaseId, setOpenPhaseId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, PhaseOverride>>({});
  /**
   * The same overrides, readable synchronously. A drag that lands right after
   * a nudge flush has to build on the dates the flush just set, not on what
   * the last render saw — so every change goes through `updateOverrides`.
   */
  const overridesRef = useRef<Record<string, PhaseOverride>>({});
  const updateOverrides = useCallback(
    (fn: (prev: Record<string, PhaseOverride>) => Record<string, PhaseOverride>) => {
      const next = fn(overridesRef.current);
      overridesRef.current = next;
      setOverrides(next);
    },
    [],
  );
  const seqRef = useRef(0);
  /** Moves still saving — a restored local entry is only trusted while its move is. */
  const inflightRef = useRef<Set<number>>(new Set());
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const [saving, setSaving] = useState(0);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [adding, setAdding] = useState<{ projectId?: string; date: string; n: number } | null>(null);
  const controlRef = useRef<TimelineControl | null>(null);
  /**
   * Set when the selection is "a step and everything after it" on one job:
   * that job's open steps past the window (no bar on screen) move with it.
   * Captured into each drag / nudge burst when it starts, never read later.
   */
  const [selectionTail, setSelectionTail] = useState<string | null>(null);
  const changeSelection = useCallback((next: Set<string>, tailJobId?: string) => {
    setSelectionTail(tailJobId ?? null);
    setSelection(next);
  }, []);

  const [health, setHealth] = useState<Map<string, ProjectHealth>>(new Map());
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Mode, zoom and which jobs are open are per-screen: the shop TV keeps the
  // wall, Jorge's laptop keeps whatever he last used.
  useEffect(() => {
    // The mode is stored as a bare string — that's what the old board wrote,
    // so the shop TV comes back on the Wall after the update.
    let saved = "jobs";
    try {
      saved = localStorage.getItem(MODE_KEY) ?? "jobs";
    } catch {
      // Restricted storage must not prevent the board from opening.
    }
    // Browser-only preferences are restored after hydration to match the server HTML.
    setMode(saved === "tv" || saved === "crew" ? saved : "jobs");
    const range = readJson<number>(RANGE_KEY, 28);
    if (range >= 7 && range <= 165) setVisibleDays(range);
    setExpanded(new Set(readJson<string[]>(EXPANDED_KEY, [])));
    let savedView: string | null = null;
    let savedPm: string | null = null;
    try {
      savedView = localStorage.getItem(VIEW_KEY);
      savedPm = localStorage.getItem(PM_KEY);
    } catch {
      // Restricted storage: the list and everyone's jobs are the defaults.
    }
    setJobsView(savedView === "timeline" ? "timeline" : "list");
    const jobs = [...dataRef.current.onsite, ...dataRef.current.starting];
    const mine = !!viewerId && jobs.some((j) => j.pm?.id === viewerId);
    setPm(savedPm ?? (mine ? (viewerId as string) : "all"));
  }, [viewerId]);

  const changeJobsView = (next: JobsView) => {
    setJobsView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private browsing — the preference just won't stick.
    }
  };

  const changePm = (next: string) => {
    setPm(next);
    try {
      localStorage.setItem(PM_KEY, next);
    } catch {
      // Private browsing — the preference just won't stick.
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Private browsing — the preference just won't stick.
    }
  };

  const changeRange = (days: number) => {
    setVisibleDays(days);
    writeJson(RANGE_KEY, days);
  };

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeJson(EXPANDED_KEY, Array.from(next));
      return next;
    });
  }, []);

  // ── Apply pending moves over the server payload ────────────────

  const colOf = useMemo(() => new Map(data.days.map((d, i) => [d.str, i + 1])), [data.days]);
  const firstStr = data.days[0]?.str ?? "";
  const lastStr = data.days[data.days.length - 1]?.str ?? "";

  const applyOverrides = useCallback(
    (bar: BoardBar): BoardBar => {
      const o = overrides[bar.id];
      if (!o) return bar;
      const startDate = o.startDate ?? bar.startDate;
      const endDate = o.endDate ?? bar.endDate;
      const clampedStart = startDate < firstStr ? firstStr : startDate > lastStr ? lastStr : startDate;
      const clampedEnd = endDate > lastStr ? lastStr : endDate < firstStr ? firstStr : endDate;
      return {
        ...bar,
        startDate,
        endDate,
        startCol: colOf.get(clampedStart) ?? bar.startCol,
        endCol: colOf.get(clampedEnd) ?? bar.endCol,
        clippedStart: startDate < firstStr,
        clippedEnd: endDate > lastStr,
        assignedEmployeeIds: o.assignedEmployeeIds ?? bar.assignedEmployeeIds,
        assignedSubIds: o.assignedSubIds ?? bar.assignedSubIds,
      };
    },
    [overrides, colOf, firstStr, lastStr],
  );

  const view = useMemo<BoardData>(() => {
    if (Object.keys(overrides).length === 0) return data;
    const patchJob = (j: BoardJob): BoardJob => ({ ...j, bars: j.bars.map(applyOverrides) });
    return { ...data, onsite: data.onsite.map(patchJob), starting: data.starting.map(patchJob) };
  }, [data, overrides, applyOverrides]);

  // Once the server has the new dates, the local copy is no longer needed.
  useEffect(() => {
    updateOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const jobs = [...data.onsite, ...data.starting];
      const live = new Map<string, { startDate: string; endDate: string; assignedEmployeeIds: string[]; assignedSubIds: string[] }>(
        jobs.flatMap((j) => j.bars).map((b) => [b.id, b]),
      );
      // Steps past the window have no bar, but a tail move still overrides them.
      for (const j of jobs) {
        for (const t of j.laterSteps) {
          if (!live.has(t.id)) live.set(t.id, { ...t, assignedEmployeeIds: [], assignedSubIds: [] });
        }
      }
      const next: Record<string, PhaseOverride> = {};
      const same = (a: string[] | undefined, b: string[]) =>
        !a || (a.length === b.length && a.every((x) => b.includes(x)));
      for (const [id, o] of Object.entries(prev)) {
        const b = live.get(id);
        if (!b) continue;
        const settled =
          (o.startDate ?? b.startDate) === b.startDate &&
          (o.endDate ?? b.endDate) === b.endDate &&
          same(o.assignedEmployeeIds, b.assignedEmployeeIds) &&
          same(o.assignedSubIds, b.assignedSubIds);
        if (!settled) next[id] = o;
      }
      return next;
    });
  }, [data, updateOverrides]);

  // Success notes clear themselves; errors stay until tapped.
  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const allBars = useMemo(() => [...view.onsite, ...view.starting].flatMap((j) => j.bars), [view]);
  const focusedJob =
    mode === "jobs" && focusJob ? ([...view.onsite, ...view.starting].find((j) => j.id === focusJob) ?? null) : null;
  const openPhase = useMemo<BoardBar | null>(() => {
    if (!openPhaseId) return null;
    const bar = allBars.find((b) => b.id === openPhaseId);
    if (bar) return bar;
    // A step outside the board's window has no bar: stand one up from the
    // job's whole schedule so its panel opens all the same.
    const step = focusedJob?.schedule.find((s) => s.id === openPhaseId);
    if (!step || !focusedJob) return null;
    return {
      id: step.id,
      projectId: focusedJob.id,
      name: step.name,
      color: step.color,
      status: step.status,
      eventType: step.eventType,
      startCol: 0,
      endCol: 0,
      clippedStart: true,
      clippedEnd: true,
      planned: null,
      slipDays: null,
      isConfirmed: step.isConfirmed,
      isExterior: false,
      risks: [],
      crew: [],
      subs: step.who,
      startDate: step.startDate,
      endDate: step.endDate,
      assignedEmployeeIds: step.assignedEmployeeIds,
      assignedSubIds: step.assignedSubIds,
      projectName: focusedJob.name,
      description: null,
      notes: null,
      phaseScope: "master",
      kind: "plan",
      memberIds: [step.id],
      isMilestone: step.eventType === "inspection",
    };
  }, [openPhaseId, allBars, focusedJob]);

  // ── Filter ─────────────────────────────────────────────────────

  // Who runs what, counted over the jobs the list shows as on site or starting.
  const { pmOptions, noPmCount } = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; count: number }>();
    let none = 0;
    for (const j of [...data.onsite, ...data.starting]) {
      if (j.quiet) continue;
      if (!j.pm) {
        none++;
        continue;
      }
      const row = byId.get(j.pm.id);
      if (row) row.count++;
      else byId.set(j.pm.id, { id: j.pm.id, name: j.pm.name, count: 1 });
    }
    return {
      pmOptions: Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name)),
      noPmCount: none,
    };
  }, [data.onsite, data.starting]);
  // A saved pick that no longer has jobs falls back to everyone.
  const pmFilter =
    pm === "all" || (pm === "none" && noPmCount > 0) || pmOptions.some((o) => o.id === pm) ? pm : "all";

  const matches = useCallback(
    (j: BoardJob) => {
      if (pmFilter !== "all" && (pmFilter === "none" ? !!j.pm : j.pm?.id !== pmFilter)) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const hay = [
        j.name,
        j.projectNumber,
        j.city ?? "",
        ...j.bars.flatMap((b) => [b.name, ...b.crew, ...b.subs]),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    },
    [query, pmFilter],
  );
  const onsite = useMemo(() => view.onsite.filter(matches), [view.onsite, matches]);
  const starting = useMemo(() => view.starting.filter(matches), [view.starting, matches]);
  const pipeline = useMemo(() => view.pipeline.filter(matches), [view.pipeline, matches]);
  const review = useMemo(() => view.review.filter(matches), [view.review, matches]);
  const showTimeline = jobsView === "timeline" && !narrow;

  // ── Writes ─────────────────────────────────────────────────────

  const moveBars = useCallback(
    (moves: BarMove[], opts?: MoveOptions) => {
      const real = moves.filter((m) => m.start !== m.bar.startDate || m.end !== m.bar.endDate);
      if (!real.length) return;
      const seq = ++seqRef.current;
      setNotice(null);

      // "Everything after": the job's steps past the window shift by the same
      // days, from wherever an earlier, still-unrefreshed move left them.
      const tail: { id: string; start: string; end: string }[] = [];
      const tailJob = opts?.tailJobId ?? null;
      const lead = tailJob ? real.find((m) => m.bar.projectId === tailJob) : undefined;
      if (tailJob && lead) {
        const delta = daysBetween(lead.bar.startDate, lead.start);
        const job = [...dataRef.current.onsite, ...dataRef.current.starting].find((j) => j.id === tailJob);
        const moving = new Set(real.map((m) => m.bar.id));
        const shifted = (id: string, start: string, end: string) => {
          const o = overridesRef.current[id];
          return { id, start: shiftDate(o?.startDate ?? start, delta), end: shiftDate(o?.endDate ?? end, delta) };
        };
        // Steps that came on screen since the pick was made still count as "after".
        for (const b of job?.bars ?? []) {
          if (moving.has(b.id) || b.kind !== "plan" || b.status === "completed") continue;
          const start = overridesRef.current[b.id]?.startDate ?? b.startDate;
          if (start >= lead.bar.startDate) tail.push(shifted(b.id, b.startDate, b.endDate));
        }
        for (const step of job?.laterSteps ?? []) {
          if (!moving.has(step.id)) tail.push(shifted(step.id, step.startDate, step.endDate));
        }
      }

      updateOverrides((prev) => {
        const next = { ...prev };
        for (const m of real) next[m.bar.id] = { ...next[m.bar.id], startDate: m.start, endDate: m.end, seq };
        for (const t of tail) next[t.id] = { ...next[t.id], startDate: t.start, endDate: t.end, seq };
        return next;
      });
      setSaving((n) => n + 1);
      inflightRef.current.add(seq);

      const rows = [
        ...real.flatMap((m) =>
          m.bar.memberIds.map((id) => ({ id, projectId: m.bar.projectId, start: m.start, end: m.end })),
        ),
        ...tail.map((t) => ({ id: t.id, projectId: tailJob as string, start: t.start, end: t.end })),
      ];

      // A failed or half-finished move must not leave dates on screen that
      // were never saved. Only this move's own local dates come off — a newer
      // move or nudge on the same bar keeps its own.
      const touched = [...real.map((m) => m.bar.id), ...tail.map((t) => t.id)];
      const dropLocal = () =>
        updateOverrides((prev) => {
          const next = { ...prev };
          for (const id of touched) if (next[id]?.seq === seq) delete next[id];
          return next;
        });

      void moveBoardPhases(rows)
        .then((res) => {
          if (res.error) {
            setNotice({ text: res.error, tone: "error" });
            dropLocal();
          } else {
            const count = real.length + tail.length;
            const steps = count === 1 ? real[0].bar.name : `${count} steps`;
            const delta = daysBetween(real[0].bar.startDate, real[0].start);
            const how =
              real.length === 1 && real[0].start !== real[0].bar.startDate && real[0].end !== real[0].bar.endDate
                ? `${Math.abs(delta)} day${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "later" : "earlier"}`
                : "";
            setNotice({
              text: `Moved ${steps}${how ? ` ${how}` : ""}${res.emailed ? ` · emailed ${res.emailed} on the job` : ""}`,
              tone: "ok",
            });
          }
          router.refresh();
        })
        .catch(() => {
          setNotice({ text: "Couldn't confirm the move. Refresh before trying again.", tone: "error" });
          dropLocal();
          router.refresh();
        })
        .finally(() => {
          inflightRef.current.delete(seq);
          setSaving((n) => n - 1);
        });
    },
    [router, updateOverrides],
  );

  /**
   * Nudges collect for a moment before saving: five taps of → is one write —
   * and one "your dates changed" email — not five. The bars move on screen
   * with every tap. The burst remembers what it started from: the bars, their
   * dates then, and whether it's an "everything after" pick.
   */
  const nudgeRef = useRef<{
    bars: BoardBar[];
    delta: number;
    timer: number | null;
    tailJobId: string | null;
    /** Each bar's local entry before the burst (or none), restored on a net 0. */
    prior: Map<string, PhaseOverride | undefined>;
  } | null>(null);

  const flushNudge = useCallback(() => {
    const n = nudgeRef.current;
    nudgeRef.current = null;
    if (!n) return;
    if (n.timer) window.clearTimeout(n.timer);
    if (n.delta === 0) {
      // Back where the burst began: put back exactly what was there — an
      // earlier, still-saving move's entry (with its seq) or nothing at all.
      updateOverrides((prev) => {
        const next = { ...prev };
        for (const b of n.bars) {
          const before = n.prior.get(b.id);
          // Only while the move that wrote it is still saving — a move that has
          // since failed already took its dates back.
          const live = before && (before.seq === undefined || inflightRef.current.has(before.seq));
          if (live) next[b.id] = before;
          else delete next[b.id];
        }
        return next;
      });
      return;
    }
    moveBars(
      n.bars.map((b) => ({ bar: b, start: shiftDate(b.startDate, n.delta), end: shiftDate(b.endDate, n.delta) })),
      { group: true, tailJobId: n.tailJobId },
    );
  }, [moveBars, updateOverrides]);

  const nudge = useCallback(
    (days: number) => {
      let n = nudgeRef.current;
      if (!n) {
        const bars = allBars.filter((b) => selection.has(b.id));
        if (!bars.length) return;
        n = {
          bars,
          delta: 0,
          timer: null,
          tailJobId: selectionTail,
          prior: new Map(bars.map((b) => [b.id, overridesRef.current[b.id]])),
        };
        nudgeRef.current = n;
      }
      n.delta += days;
      const { bars, delta } = n;
      updateOverrides((prev) => {
        const next = { ...prev };
        for (const b of bars) {
          next[b.id] = {
            ...next[b.id],
            startDate: shiftDate(b.startDate, delta),
            endDate: shiftDate(b.endDate, delta),
            seq: undefined,
          };
        }
        return next;
      });
      if (n.timer) window.clearTimeout(n.timer);
      n.timer = window.setTimeout(flushNudge, 700);
    },
    [allBars, selection, selectionTail, flushNudge, updateOverrides],
  );

  // A new selection (or leaving the board) saves whatever was being nudged.
  useEffect(() => () => flushNudge(), [selection, flushNudge]);

  /** A drag lands on top of a nudge still collecting: save the nudge first. */
  const dragMove = useCallback(
    (moves: BarMove[], opts?: MoveOptions) => {
      flushNudge();
      moveBars(moves, opts);
    },
    [flushNudge, moveBars],
  );

  const selectAfter = useCallback(() => {
    const [id] = Array.from(selection);
    const bar = allBars.find((b) => b.id === id);
    if (!bar) return;
    const job = [...view.onsite, ...view.starting].find((j) => j.id === bar.projectId);
    if (!job) return;
    const after = job.bars.filter(
      (b) => b.kind === "plan" && b.status !== "completed" && b.startDate >= bar.startDate,
    );
    changeSelection(new Set([bar.id, ...after.map((b) => b.id)]), job.id);
  }, [selection, allBars, view, changeSelection]);

  const fitJob = useCallback(
    (job: BoardJob) => {
      // The whole job, as far as the board has loaded it (six weeks back).
      const rawStart = job.spanStart ?? job.bars[0]?.startDate ?? data.todayStr;
      const rawEnd =
        job.spanEnd ?? job.bars.reduce((acc, b) => (b.endDate > acc ? b.endDate : acc), rawStart);
      const start = rawStart < firstStr ? firstStr : rawStart;
      const end = rawEnd > lastStr ? lastStr : rawEnd < start ? start : rawEnd;
      const span = Math.max(7, Math.min(165, daysBetween(start, end) + 3));
      setVisibleDays(span);
      if (!expanded.has(job.id)) toggleExpand(job.id);
      // Wait for the new day width and the opened rows to land before scrolling.
      window.setTimeout(() => {
        controlRef.current?.revealJob(job.id);
        controlRef.current?.scrollToDate(shiftDate(start, -1));
      }, 80);
    },
    [data.todayStr, expanded, toggleExpand, firstStr, lastStr],
  );

  // Keyboard: Esc clears, ←/→ nudge the selection, T jumps to today.
  useEffect(() => {
    if (mode !== "jobs" || !showTimeline || focusJob) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (openPhaseId || openProject || adding || updating) return;
      if (e.key === "Escape" && selection.size) changeSelection(new Set());
      else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && selection.size) {
        e.preventDefault();
        // A held key auto-repeats; only deliberate presses move anything.
        if (e.repeat) return;
        nudge(e.key === "ArrowLeft" ? -1 : 1);
      } else if (e.key.toLowerCase() === "t" && !e.metaKey && !e.ctrlKey) {
        controlRef.current?.scrollToDate(data.todayStr);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, showTimeline, focusJob, selection, nudge, data.todayStr, openPhaseId, openProject, adding, updating, changeSelection]);

  // ── AI health read ─────────────────────────────────────────────

  const loadHealth = useCallback(async (force: boolean) => {
    if (!force) {
      try {
        const raw = sessionStorage.getItem(HEALTH_CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw) as { at: number; projects: ProjectHealth[] };
          if (Date.now() - cached.at < HEALTH_CACHE_TTL_MS) {
            setHealth(new Map(cached.projects.map((p) => [p.id, p])));
            return;
          }
        }
      } catch {
        // Bad cache — fall through to a fresh read.
      }
    }
    setHealthLoading(true);
    setHealthError(null);
    try {
      const res = await fetch("/api/board/health", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { projects: ProjectHealth[] };
      setHealth(new Map(json.projects.map((p) => [p.id, p])));
      try {
        sessionStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify({ at: Date.now(), projects: json.projects }));
      } catch {
        // Storage full — the read still rendered.
      }
    } catch {
      setHealthError("Couldn't read project health");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== "tv") return;
    const id = setInterval(() => {
      router.refresh();
      // Respect the 30-min health cache — /api/board/health is heavy.
      void loadHealth(false);
    }, TV_REFRESH_MS);
    return () => clearInterval(id);
  }, [mode, router, loadHealth]);

  const updatingJob = updating
    ? ([...view.onsite, ...view.starting, ...view.review].find((j) => j.id === updating) ?? null)
    : null;
  const allOpen = [...onsite, ...starting].every((j) => expanded.has(j.id));
  const customRange = !RANGES.some((r) => r.days === visibleDays);

  const projectOptions = useMemo(
    () =>
      [...data.onsite, ...data.starting, ...data.pipeline, ...data.review]
        .map((j) => ({ id: j.id, name: j.name, project_number: j.projectNumber }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const analyzeButton = (
    <Button variant="outline" size="sm" className="h-8" onClick={() => void loadHealth(true)} disabled={healthLoading}>
      {healthLoading ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
      )}
      {healthLoading ? "Reading jobs…" : health.size ? "Refresh AI read" : "Analyze jobs"}
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* ── Top bar: where you are, whose jobs, and one way to add ── */}
      <div className={cn("flex flex-wrap items-center gap-2", focusedJob && "hidden")}>
        <div className="flex rounded-md border border-border p-0.5">
          {(
            [
              { key: "jobs", label: "Jobs", icon: GanttChartSquare },
              { key: "crew", label: "Crew", icon: Users },
              { key: "tv", label: "Wall", icon: Monitor },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => switchMode(key)}
              aria-pressed={mode === key}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium",
                mode === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="hidden h-3.5 w-3.5 sm:block" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {mode === "jobs" && (
          <>
            <select
              aria-label="Show jobs for"
              value={pmFilter}
              onChange={(e) => changePm(e.target.value)}
              className="h-8 max-w-[7.5rem] min-w-0 rounded-md border border-border bg-background px-2 text-xs font-medium sm:max-w-[10rem]"
            >
              <option value="all">All PMs</option>
              {pmOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {firstName(o.name)} · {o.count}
                </option>
              ))}
              {noPmCount > 0 && <option value="none">No PM · {noPmCount}</option>}
            </select>
            {!narrow && (
              <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="How to show the jobs">
                {(
                  [
                    { key: "list", label: "Cards", icon: List },
                    { key: "timeline", label: "Gantt", icon: GanttChartSquare },
                  ] as const
                ).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => changeJobsView(key)}
                    aria-pressed={jobsView === key}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-2 py-1 text-xs",
                      jobsView === key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="relative hidden lg:block">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                aria-label="Find a job, step or person"
                placeholder="Find job, step, person…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 w-44 pl-7 text-xs lg:w-52"
              />
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {saving > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving
            </span>
          )}
          {mode === "crew" && <SubsNeededChip />}
          {mode === "tv" && analyzeButton}
          {mode === "jobs" && (
            <Button size="sm" className="h-8" aria-label="Add step" onClick={() => setAdding({ date: data.todayStr, n: Date.now() })}>
              <Plus className="h-3.5 w-3.5 sm:mr-1" aria-hidden />
              <span className="hidden sm:inline">Add step</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Timeline tools: only when the timeline is what's on screen ── */}
      {mode === "jobs" && showTimeline && !focusedJob && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => controlRef.current?.page(-1)} aria-label="Earlier">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => controlRef.current?.scrollToDate(data.todayStr)}>
              Today
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => controlRef.current?.page(1)} aria-label="Later">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="How much time to show">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => changeRange(r.days)}
                aria-pressed={visibleDays === r.days}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  visibleDays === r.days ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
            {customRange && <span className="rounded bg-muted px-2 py-1 text-xs font-medium">{visibleDays} days</span>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => {
              const ids = [...onsite, ...starting].map((j) => j.id);
              const next = allOpen ? new Set<string>() : new Set(ids);
              setExpanded(next);
              writeJson(EXPANDED_KEY, Array.from(next));
            }}
          >
            {allOpen ? <ChevronsDownUp className="mr-1 h-3.5 w-3.5" aria-hidden /> : <ChevronsUpDown className="mr-1 h-3.5 w-3.5" aria-hidden />}
            {allOpen ? "Close all" : "Open all"}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <SubsNeededChip />
            {analyzeButton}
            <span
              className="text-muted-foreground"
              title="Drag a bar to move it. Drag an end to stretch it. Shift-click to pick several. Alt-drag moves a step and everything after. Double-click a row to add a step. Arrow keys nudge what is picked. T jumps to today."
            >
              <Info className="h-4 w-4" aria-label="Timeline tips" />
            </span>
          </div>
        </div>
      )}

      {mode !== "tv" && !focusedJob && <SubsTodayStrip onOpenProject={setOpenProject} />}
      {healthError && <p className="text-xs text-red-400">{healthError} — tap Refresh to retry.</p>}

      {focusedJob ? (
        <BoardJobSchedule
          key={focusedJob.id}
          job={focusedJob}
          todayStr={data.todayStr}
          onBack={() => setFocusJob(null)}
          onOpenStep={(step) => setOpenPhaseId(step.id)}
          onUpdate={() => setUpdating(focusedJob.id)}
          onAddStep={() => setAdding({ projectId: focusedJob.id, date: data.todayStr, n: Date.now() })}
          onOpenProject={() => setOpenProject(focusedJob.id)}
        />
      ) : mode === "jobs" && !showTimeline ? (
        <BoardList
          onsite={onsite}
          starting={starting}
          review={review}
          todayStr={data.todayStr}
          onOpenProject={setOpenProject}
          onOpenPhase={(bar) => setOpenPhaseId(bar.id)}
          onUpdate={(job) => setUpdating(job.id)}
          onOpenSchedule={(job) => setFocusJob(job.id)}
        />
      ) : mode === "jobs" ? (
        <BoardTimeline
          data={view}
          onsite={onsite}
          starting={starting}
          pipeline={pipeline}
          health={health}
          visibleDays={visibleDays}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          selection={selection}
          onSelectionChange={changeSelection}
          selectionTail={selectionTail}
          allBars={allBars}
          onOpenProject={setOpenProject}
          onOpenPhase={(bar) => setOpenPhaseId(bar.id)}
          onMoveBars={dragMove}
          onAddStep={(projectId, date) => setAdding({ projectId, date, n: Date.now() })}
          onFitJob={fitJob}
          onUpdateJob={(job) => setUpdating(job.id)}
          controlRef={controlRef}
        />
      ) : mode === "crew" ? (
        <BoardCrew data={crew} />
      ) : (
        <BoardTv data={view} health={health} onOpen={setOpenProject} />
      )}

      {/* ── Selection bar ── */}
      {mode === "jobs" && showTimeline && !focusedJob && selection.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-popover px-3 py-2 text-sm shadow-xl">
            <span className="font-medium">{selection.size} picked</span>
            <span className="text-xs text-muted-foreground">drag any one to move them all</span>
            <Button variant="outline" size="sm" className="h-7" onClick={() => nudge(-1)}>
              <ChevronLeft className="mr-0.5 h-3.5 w-3.5" aria-hidden />1 day
            </Button>
            <Button variant="outline" size="sm" className="h-7" onClick={() => nudge(1)}>
              1 day
              <ChevronRight className="ml-0.5 h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="outline" size="sm" className="h-7" onClick={() => nudge(7)}>
              1 week
              <ChevronRight className="ml-0.5 h-3.5 w-3.5" aria-hidden />
            </Button>
            {selection.size === 1 && (
              <Button variant="outline" size="sm" className="h-7" onClick={selectAfter}>
                <ListPlus className="mr-1 h-3.5 w-3.5" aria-hidden />
                + everything after
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7" onClick={() => changeSelection(new Set())} aria-label="Clear the selection">
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <div className={cn("pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4", selection.size ? "bottom-20" : "bottom-5")}>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className={cn(
              "pointer-events-auto rounded-lg border px-3 py-1.5 text-xs shadow-lg",
              notice.tone === "error"
                ? "border-red-500/40 bg-red-950/90 text-red-200"
                : "border-emerald-500/40 bg-emerald-950/90 text-emerald-200",
            )}
          >
            {notice.text}
          </button>
        </div>
      )}

      <BoardPhasePanel
        bar={openPhase}
        onClose={() => {
          setOpenPhaseId(null);
          router.refresh();
        }}
        onAssigned={(barId, employeeIds, subIds) =>
          updateOverrides((prev) => ({
            ...prev,
            [barId]: { ...prev[barId], assignedEmployeeIds: employeeIds, assignedSubIds: subIds },
          }))
        }
        onAssignFailed={(barId) => {
          // Drop the local crew list and show what the server really has.
          updateOverrides((prev) => {
            const next = { ...prev };
            const o = next[barId];
            if (!o) return prev;
            const rest = { ...o };
            delete rest.assignedEmployeeIds;
            delete rest.assignedSubIds;
            if (rest.startDate || rest.endDate) next[barId] = rest;
            else delete next[barId];
            return next;
          });
          router.refresh();
        }}
      />

      <BoardDrawer
        projectId={openProject}
        health={openProject ? health.get(openProject) : undefined}
        onClose={() => setOpenProject(null)}
      />

      {updatingJob && (
        <BoardUpdateSheet
          key={updatingJob.id}
          job={updatingJob}
          todayStr={data.todayStr}
          onClose={() => setUpdating(null)}
          onSaved={(message) => {
            setUpdating(null);
            setNotice({ text: message, tone: "ok" });
            router.refresh();
          }}
          onAddStep={(projectId) => {
            setUpdating(null);
            setAdding({ projectId, date: data.todayStr, n: Date.now() });
          }}
        />
      )}

      {adding && (
        <ScheduleQuickAddSheet
          key={adding.n}
          open
          onOpenChange={(o) => !o && setAdding(null)}
          projects={projectOptions}
          initialProjectId={adding.projectId}
          defaultDate={adding.date}
          onCreated={(projectId) => {
            setAdding(null);
            if (!expanded.has(projectId)) toggleExpand(projectId);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
