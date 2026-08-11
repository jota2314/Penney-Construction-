"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Loader2,
  Package,
  RefreshCw,
  Sparkles,
} from "lucide-react";

// ── Data shapes (selected columns only — see /board/page.tsx) ────

export interface BoardProject {
  id: string;
  name: string;
  project_number: string;
  status: string;
  phase: string | null;
}

export interface BoardPhase {
  id: string;
  project_id: string | null;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  color: string;
  event_type: string | null;
}

export interface BoardOrder {
  id: string;
  project_id: string | null;
  order_number: string;
  status: string;
  needed_by: string | null;
  notes: string | null;
  material_order_items: { item_name: string }[];
}

export interface BoardTodo {
  id: string;
  project_id: string | null;
  description: string;
  due_date: string | null;
  priority: string;
}

interface ProjectHealth {
  id: string;
  health: "green" | "yellow" | "red";
  note: string;
  issues: string[];
}

interface JobBoardProps {
  projects: BoardProject[];
  phases: BoardPhase[];
  orders: BoardOrder[];
  todos: BoardTodo[];
}

// ── Date helpers (local time, YYYY-MM-DD keys) ───────────────────

function dateToStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const DAYS_BACK = 7;
const DAYS_FORWARD = 60;

const STATUS_LABELS: Record<string, string> = {
  in_progress: "In Construction",
  contracted: "Contracted",
  proposal_sent: "Proposal Sent",
  estimating: "Estimating",
};

const STATUS_BADGE: Record<string, string> = {
  in_progress: "bg-green-500/15 text-green-500",
  contracted: "bg-blue-500/15 text-blue-400",
  proposal_sent: "bg-amber-500/15 text-amber-500",
  estimating: "bg-slate-500/15 text-slate-400",
};

const HEALTH_DOT: Record<string, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

const HEALTH_CACHE_KEY = "job-board-health-v1";
const HEALTH_CACHE_TTL_MS = 30 * 60 * 1000;

export function JobBoard({ projects, phases, orders, todos }: JobBoardProps) {
  const todayStr = dateToStr(new Date());

  // Rolling date window: a week of history, two months ahead.
  const days = useMemo(() => {
    const start = addDays(new Date(), -DAYS_BACK);
    return Array.from({ length: DAYS_BACK + DAYS_FORWARD + 1 }, (_, i) => {
      const d = addDays(start, i);
      return {
        str: dateToStr(d),
        dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
        label: d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
      };
    });
  }, []);

  // Cell lookups keyed by `${projectId}|${dateStr}`.
  const cellData = useMemo(() => {
    const starts = new Map<string, BoardPhase[]>();
    const spans = new Map<string, BoardPhase[]>();
    const orderMap = new Map<string, BoardOrder[]>();
    const todoMap = new Map<string, BoardTodo[]>();
    const push = <T,>(m: Map<string, T[]>, k: string, v: T) => {
      const arr = m.get(k);
      if (arr) arr.push(v);
      else m.set(k, [v]);
    };

    const windowStart = days[0].str;
    const windowEnd = days[days.length - 1].str;

    for (const ph of phases) {
      if (!ph.project_id || !ph.start_date) continue;
      const end = ph.end_date || ph.start_date;
      if (end < windowStart || ph.start_date > windowEnd) continue;
      push(starts, `${ph.project_id}|${ph.start_date}`, ph);
      // Continuation band on every covered day after the start.
      let d = new Date(`${ph.start_date}T00:00:00`);
      const last = new Date(`${end}T00:00:00`);
      // Hard cap keeps a bad end_date from looping for years.
      for (let i = 0; i < 120 && d < last; i++) {
        d = addDays(d, 1);
        push(spans, `${ph.project_id}|${dateToStr(d)}`, ph);
      }
    }
    for (const o of orders) {
      if (o.project_id && o.needed_by) push(orderMap, `${o.project_id}|${o.needed_by}`, o);
    }
    for (const t of todos) {
      if (t.project_id && t.due_date) push(todoMap, `${t.project_id}|${t.due_date}`, t);
    }
    return { starts, spans, orderMap, todoMap };
  }, [phases, orders, todos, days]);

  // ── AI health read ─────────────────────────────────────────────

  const [health, setHealth] = useState<Map<string, ProjectHealth>>(new Map());
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

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
      const data = (await res.json()) as { projects: ProjectHealth[] };
      setHealth(new Map(data.projects.map((p) => [p.id, p])));
      try {
        sessionStorage.setItem(
          HEALTH_CACHE_KEY,
          JSON.stringify({ at: Date.now(), projects: data.projects }),
        );
      } catch {
        // Storage full/unavailable — the read still rendered.
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

  // ── Scroll: start on today, drag-to-pan with mouse (touch is native) ──

  const scrollRef = useRef<HTMLDivElement>(null);
  const todayHeaderRef = useRef<HTMLTableCellElement>(null);
  const drag = useRef<{ startX: number; startLeft: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const today = todayHeaderRef.current;
    if (el && today) {
      // Land with today just right of the sticky project column.
      el.scrollLeft = Math.max(0, today.offsetLeft - 232);
    }
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || e.button !== 0) return;
    drag.current = { startX: e.clientX, startLeft: el.scrollLeft };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || !drag.current) return;
    el.scrollLeft = drag.current.startLeft - (e.clientX - drag.current.startX);
  };
  const endDrag = () => {
    drag.current = null;
  };

  const [expandedProject, setExpandedProject] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {projects.length} active jobs · swipe the dates
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadHealth(true)}
          disabled={healthLoading}
        >
          {healthLoading ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1" />
          )}
          {healthLoading ? "Reading jobs…" : "Refresh AI read"}
        </Button>
      </div>
      {healthError && (
        <p className="text-xs text-red-400">{healthError} — tap Refresh to retry.</p>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto overscroll-x-contain rounded-lg border border-border bg-card select-none cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <table className="border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 w-56 min-w-56 border-b border-r border-border bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Project
              </th>
              {days.map((d) => (
                <th
                  key={d.str}
                  ref={d.str === todayStr ? todayHeaderRef : undefined}
                  className={`sticky top-0 z-20 w-32 min-w-32 border-b border-r border-border px-2 py-2 text-center text-xs font-medium ${
                    d.str === todayStr
                      ? "bg-primary/15 text-primary"
                      : d.isWeekend
                        ? "bg-muted/60 text-muted-foreground/60"
                        : "bg-card text-muted-foreground"
                  }`}
                >
                  <span className="block">{d.dayName}</span>
                  <span className="block font-semibold">{d.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const h = health.get(p.id);
              const expanded = expandedProject === p.id;
              return (
                <tr key={p.id} className="align-top">
                  <td className="sticky left-0 z-10 w-56 min-w-56 border-b border-r border-border bg-card px-3 py-2">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                          h ? HEALTH_DOT[h.health] : "bg-muted-foreground/30"
                        }`}
                        title={h?.note ?? "No AI read yet"}
                        onClick={() => setExpandedProject(expanded ? null : p.id)}
                        aria-label="Toggle issues"
                      />
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${p.id}`}
                          className="block truncate text-sm font-medium hover:text-primary"
                          draggable={false}
                        >
                          {p.name}
                        </Link>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>{p.project_number}</span>
                          <span
                            className={`rounded px-1 py-px ${STATUS_BADGE[p.status] ?? "bg-muted text-muted-foreground"}`}
                          >
                            {STATUS_LABELS[p.status] ?? p.status}
                          </span>
                        </div>
                        {h?.note && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {h.note}
                          </p>
                        )}
                        {h && h.issues.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {(expanded ? h.issues : h.issues.slice(0, 2)).map((iss, i) => (
                              <p
                                key={i}
                                className="flex items-start gap-1 text-[11px] leading-tight text-red-400"
                              >
                                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                                <span>{iss}</span>
                              </p>
                            ))}
                            {!expanded && h.issues.length > 2 && (
                              <button
                                type="button"
                                className="text-[11px] text-muted-foreground underline"
                                onClick={() => setExpandedProject(p.id)}
                              >
                                +{h.issues.length - 2} more
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  {days.map((d) => {
                    const key = `${p.id}|${d.str}`;
                    const cellStarts = cellData.starts.get(key);
                    const cellSpans = cellData.spans.get(key);
                    const cellOrders = cellData.orderMap.get(key);
                    const cellTodos = cellData.todoMap.get(key);
                    const empty = !cellStarts && !cellSpans && !cellOrders && !cellTodos;
                    return (
                      <td
                        key={d.str}
                        className={`w-32 min-w-32 border-b border-r border-border/60 px-1 py-1 ${
                          d.str === todayStr
                            ? "bg-primary/5"
                            : d.isWeekend
                              ? "bg-muted/30"
                              : ""
                        }`}
                      >
                        {!empty && (
                          <div className="space-y-1">
                            {cellSpans?.map((ph) => (
                              <div
                                key={`span-${ph.id}`}
                                className="h-1.5 rounded-full opacity-60"
                                style={{ backgroundColor: ph.color || "#f59e0b" }}
                                title={ph.name}
                              />
                            ))}
                            {cellStarts?.map((ph) => (
                              <div
                                key={ph.id}
                                className="truncate rounded border-l-2 bg-muted/70 px-1.5 py-0.5 text-[11px] leading-tight"
                                style={{ borderLeftColor: ph.color || "#f59e0b" }}
                                title={ph.name}
                              >
                                {ph.name}
                              </div>
                            ))}
                            {cellOrders?.map((o) => (
                              <div
                                key={o.id}
                                className={`flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] leading-tight ${
                                  d.str < todayStr && o.status !== "ready"
                                    ? "bg-red-500/15 text-red-400"
                                    : "bg-amber-500/15 text-amber-500"
                                }`}
                                title={`${o.order_number} · ${o.status}`}
                              >
                                <Package className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  {o.material_order_items[0]?.item_name || o.notes || o.order_number}
                                </span>
                              </div>
                            ))}
                            {cellTodos?.map((t) => (
                              <div
                                key={t.id}
                                className={`truncate rounded px-1.5 py-0.5 text-[11px] leading-tight ${
                                  d.str < todayStr
                                    ? "bg-red-500/15 text-red-400"
                                    : "bg-blue-500/15 text-blue-400"
                                }`}
                                title={t.description}
                              >
                                {t.description}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td className="px-3 py-8 text-center text-sm text-muted-foreground" colSpan={days.length + 1}>
                  No active jobs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
