"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BadgeDollarSign, Loader2, Monitor, Sparkles, Table2, ZoomIn, ZoomOut } from "lucide-react";
import type { BoardBar, BoardData, BoardJob } from "@/lib/board/board-data";
import { updateSchedulePhase } from "@/lib/actions/schedule";
import { BoardLanes, COL_SIZES, type BoardSize } from "./board-lanes";
import { BoardTv } from "./board-tv";
import { BoardDrawer } from "./board-drawer";
import { BoardPhasePanel } from "./board-phase-panel";

/**
 * The job board shell: mode switch, size control, the AI health read, the
 * project drawer, and the phase panel.
 *
 * Two modes over one dataset — LANES for planning at a desk, WALL for the TV
 * in the shop. Both read the same server payload, so switching costs nothing
 * and the two can never disagree.
 *
 * Phase edits (drag to move, assign someone) are applied optimistically here
 * and written through `updateSchedulePhase`, then reconciled by a refresh.
 * Holding the overrides at this level means the drag survives the panel
 * opening and closing over it.
 */

export interface ProjectHealth {
  id: string;
  health: "green" | "yellow" | "red";
  note: string;
  issues: string[];
}

const HEALTH_CACHE_KEY = "job-board-health-v2";
const HEALTH_CACHE_TTL_MS = 30 * 60 * 1000;
const MODE_KEY = "job-board-mode";
const SIZE_KEY = "job-board-size";
const TV_REFRESH_MS = 5 * 60 * 1000;

type Mode = "lanes" | "tv";

/** Local edits waiting on the server round trip. */
interface PhaseOverride {
  startDate?: string;
  endDate?: string;
  assignedEmployeeIds?: string[];
  assignedSubIds?: string[];
}

const SIZE_ORDER: BoardSize[] = ["compact", "comfortable", "large"];

export function JobBoard({ data }: { data: BoardData }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("lanes");
  const [size, setSize] = useState<BoardSize>("comfortable");
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [openPhaseId, setOpenPhaseId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, PhaseOverride>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const [health, setHealth] = useState<Map<string, ProjectHealth>>(new Map());
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Mode and size are per-screen: the shop TV keeps the wall at large, Jorge's
  // laptop keeps lanes at whatever he last used.
  useEffect(() => {
    const savedMode = localStorage.getItem(MODE_KEY);
    if (savedMode === "tv" || savedMode === "lanes") setMode(savedMode);
    const savedSize = localStorage.getItem(SIZE_KEY);
    if (savedSize && SIZE_ORDER.includes(savedSize as BoardSize)) {
      setSize(savedSize as BoardSize);
    }
  }, []);

  const persist = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private browsing — the preference just won't stick.
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    persist(MODE_KEY, next);
  };

  const stepSize = (dir: 1 | -1) => {
    const i = SIZE_ORDER.indexOf(size);
    const next = SIZE_ORDER[Math.min(SIZE_ORDER.length - 1, Math.max(0, i + dir))];
    setSize(next);
    persist(SIZE_KEY, next);
  };

  // ── Apply pending edits over the server payload ────────────────

  const applyOverrides = useCallback(
    (bar: BoardBar): BoardBar => {
      const o = overrides[bar.id];
      if (!o) return bar;
      const startDate = o.startDate ?? bar.startDate;
      const endDate = o.endDate ?? bar.endDate;
      const shiftStart = dayDelta(bar.startDate, startDate);
      const shiftEnd = dayDelta(bar.endDate, endDate);
      return {
        ...bar,
        startDate,
        endDate,
        startCol: bar.startCol + shiftStart,
        endCol: bar.endCol + shiftEnd,
        assignedEmployeeIds: o.assignedEmployeeIds ?? bar.assignedEmployeeIds,
        assignedSubIds: o.assignedSubIds ?? bar.assignedSubIds,
      };
    },
    [overrides],
  );

  const view = useMemo(() => {
    if (Object.keys(overrides).length === 0) return data;
    const patchJob = (j: BoardJob): BoardJob => ({ ...j, bars: j.bars.map(applyOverrides) });
    return {
      ...data,
      onsite: data.onsite.map(patchJob),
      starting: data.starting.map(patchJob),
    };
  }, [data, overrides, applyOverrides]);

  const allBars = useMemo(
    () => [...view.onsite, ...view.starting].flatMap((j) => j.bars),
    [view],
  );
  const openPhase = openPhaseId ? (allBars.find((b) => b.id === openPhaseId) ?? null) : null;

  // ── Writes ─────────────────────────────────────────────────────

  const movePhase = useCallback(
    (bar: BoardBar, startDate: string, endDate: string) => {
      setSaveError(null);
      setOverrides((prev) => ({ ...prev, [bar.id]: { ...prev[bar.id], startDate, endDate } }));
      void updateSchedulePhase(bar.id, {
        project_id: bar.projectId,
        start_date: startDate,
        end_date: endDate,
      }).then((res) => {
        if (res.error) {
          // Put it back where it was — the move didn't happen.
          setSaveError(`Couldn't move ${bar.name}: ${res.error}`);
          setOverrides((prev) => {
            const next = { ...prev };
            delete next[bar.id];
            return next;
          });
        } else {
          router.refresh();
        }
      });
    },
    [router],
  );

  const assignPhase = useCallback(
    (barId: string, employeeIds: string[], subIds: string[]) => {
      setOverrides((prev) => ({
        ...prev,
        [barId]: { ...prev[barId], assignedEmployeeIds: employeeIds, assignedSubIds: subIds },
      }));
    },
    [],
  );

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
        sessionStorage.setItem(
          HEALTH_CACHE_KEY,
          JSON.stringify({ at: Date.now(), projects: json.projects }),
        );
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
    void loadHealth(false);
  }, [loadHealth]);

  useEffect(() => {
    if (mode !== "tv") return;
    const id = setInterval(() => {
      router.refresh();
      // Respect the 30-min health cache — forcing a fresh AI health read on
      // every 5-min TV tick kept /api/board/health (a heavy route that has
      // hit the 60s function timeout) running nearly continuously all day.
      void loadHealth(false);
    }, TV_REFRESH_MS);
    return () => clearInterval(id);
  }, [mode, router, loadHealth]);

  const total = data.onsite.length + data.starting.length + data.pipeline.length;
  const crewOut = data.onsite.reduce((n, j) => n + j.crewToday.length, 0);
  const sizeIndex = SIZE_ORDER.indexOf(size);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs text-muted-foreground">
            {total} active jobs · {data.onsite.length} on site · {crewOut} clocked in
            {!data.canSeeMoney && " · pricing hidden"}
          </p>
          {data.canSeeMoney && data.dueInWindow > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-600/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300"
              title="Contract payments landing inside the visible window that have not been collected yet"
            >
              <BadgeDollarSign className="h-3.5 w-3.5" aria-hidden />
              ${Math.round(data.dueInWindow).toLocaleString()} to collect
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {mode === "lanes" && (
            <div className="flex items-center rounded-md border border-border p-0.5">
              <button
                type="button"
                onClick={() => stepSize(-1)}
                disabled={sizeIndex === 0}
                aria-label="Smaller squares"
                className="rounded px-1.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ZoomOut className="h-3.5 w-3.5" aria-hidden />
              </button>
              <span className="px-1 text-[11px] capitalize text-muted-foreground">{size}</span>
              <button
                type="button"
                onClick={() => stepSize(1)}
                disabled={sizeIndex === SIZE_ORDER.length - 1}
                aria-label="Bigger squares"
                className="rounded px-1.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ZoomIn className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}
          <div className="flex rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => switchMode("lanes")}
              aria-pressed={mode === "lanes"}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
                mode === "lanes" ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden />
              Lanes
            </button>
            <button
              type="button"
              onClick={() => switchMode("tv")}
              aria-pressed={mode === "tv"}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
                mode === "tv" ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}
            >
              <Monitor className="h-3.5 w-3.5" aria-hidden />
              Wall
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadHealth(true)}
            disabled={healthLoading}
          >
            {healthLoading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
            )}
            {healthLoading ? "Reading jobs…" : "Refresh AI read"}
          </Button>
        </div>
      </div>

      {healthError && <p className="text-xs text-red-400">{healthError} — tap Refresh to retry.</p>}
      {saveError && <p className="text-xs text-red-400">{saveError}</p>}

      {mode === "lanes" ? (
        <BoardLanes
          data={view}
          health={health}
          colW={COL_SIZES[size]}
          onOpenProject={setOpenProject}
          onOpenPhase={(bar) => setOpenPhaseId(bar.id)}
          onMovePhase={movePhase}
        />
      ) : (
        <BoardTv data={view} health={health} onOpen={setOpenProject} />
      )}

      <BoardPhasePanel
        bar={openPhase}
        onClose={() => setOpenPhaseId(null)}
        onAssigned={assignPhase}
      />

      <BoardDrawer
        projectId={openProject}
        health={openProject ? health.get(openProject) : undefined}
        onClose={() => setOpenProject(null)}
      />
    </div>
  );
}

/** Whole days between two YYYY-MM-DD strings. */
function dayDelta(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}
