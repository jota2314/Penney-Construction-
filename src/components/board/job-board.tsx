"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Monitor, Sparkles, Table2 } from "lucide-react";
import type { BoardData } from "@/lib/board/board-data";
import { BoardLanes } from "./board-lanes";
import { BoardTv } from "./board-tv";
import { BoardDrawer } from "./board-drawer";

/**
 * The job board shell: mode switch, the AI health read, and the drawer.
 *
 * Two modes over one dataset — LANES for planning at a desk, WALL for the TV
 * in the shop. Both read the same server payload, so switching costs nothing
 * and the two can never disagree.
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
/** The wall reloads itself; nobody is standing there to hit refresh. */
const TV_REFRESH_MS = 5 * 60 * 1000;

type Mode = "lanes" | "tv";

export function JobBoard({ data }: { data: BoardData }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("lanes");
  const [openProject, setOpenProject] = useState<string | null>(null);

  const [health, setHealth] = useState<Map<string, ProjectHealth>>(new Map());
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Mode is a per-screen preference: the shop TV stays on the wall, Jorge's
  // laptop stays on lanes.
  useEffect(() => {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "tv" || saved === "lanes") setMode(saved);
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Private browsing — the mode just won't persist.
    }
  };

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

  // Wall mode pulls fresh server data on its own so the TV never goes stale.
  useEffect(() => {
    if (mode !== "tv") return;
    const id = setInterval(() => {
      router.refresh();
      void loadHealth(true);
    }, TV_REFRESH_MS);
    return () => clearInterval(id);
  }, [mode, router, loadHealth]);

  const total = data.onsite.length + data.starting.length + data.pipeline.length;
  const crewOut = data.onsite.reduce((n, j) => n + j.crewToday.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total} active jobs · {data.onsite.length} on site · {crewOut} clocked in
          {!data.canSeeMoney && " · pricing hidden"}
        </p>
        <div className="flex items-center gap-1.5">
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

      {healthError && (
        <p className="text-xs text-red-400">{healthError} — tap Refresh to retry.</p>
      )}

      {mode === "lanes" ? (
        <BoardLanes data={data} health={health} onOpen={setOpenProject} />
      ) : (
        <BoardTv data={data} health={health} onOpen={setOpenProject} />
      )}

      <BoardDrawer
        projectId={openProject}
        health={openProject ? health.get(openProject) : undefined}
        onClose={() => setOpenProject(null)}
      />
    </div>
  );
}
