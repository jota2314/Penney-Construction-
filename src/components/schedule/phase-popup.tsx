"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, Users, X, Pencil, Trash2, ArrowRight } from "lucide-react";
import type { SequenceIssue, PhaseLink } from "@/lib/schedule/sequence-check";

// Everything you can do to a phase, opened on the bar you tapped rather than
// parked at the bottom of the chart.

export interface PopupPhase {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  color: string;
  notes?: string | null;
  is_confirmed?: boolean;
  confirmed_with?: string | null;
  assigned_employee_ids?: string[];
}

export interface PhasePatch {
  name: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  assigned_employee_ids: string[];
}

export interface PopupEmployee {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
}

const WIDTH = 340;
const MARGIN = 10;

function pretty(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function spanDays(a: string, b: string): number {
  return (
    Math.round(
      (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000
    ) + 1
  );
}

export function PhasePopup({
  phase,
  anchor,
  issues,
  predecessors,
  successors,
  nameOf,
  employees,
  onSelectPhase,
  onClose,
  onStatusChange,
  onConfirmPhase,
  onUpdatePhase,
  onDeletePhase,
  onOpenInList,
}: {
  phase: PopupPhase;
  /** Screen position of the bar that was clicked. */
  anchor: { x: number; top: number; bottom: number };
  issues: SequenceIssue[];
  predecessors: PhaseLink[];
  successors: PhaseLink[];
  nameOf: (id: string) => string;
  employees: PopupEmployee[];
  onSelectPhase: (id: string) => void;
  onClose: () => void;
  onStatusChange?: (id: string, status: string) => void;
  onConfirmPhase?: (id: string, currentlyConfirmed: boolean) => void;
  onUpdatePhase?: (id: string, patch: PhasePatch) => void;
  onDeletePhase?: (id: string) => void;
  onOpenInList?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [crew, setCrew] = useState<Set<string>>(new Set(phase.assigned_employee_ids ?? []));

  // Placed from the anchor alone — no measure-then-reposition, so it never
  // paints in the wrong spot first. A bar low on the screen opens upward,
  // pinned by its bottom edge; the height is capped to whatever room is left
  // and the body scrolls inside.
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const left = Math.min(
    Math.max(MARGIN, anchor.x - WIDTH / 2),
    Math.max(MARGIN, vw - WIDTH - MARGIN)
  );
  const openUp = anchor.bottom > vh * 0.55;
  const room = openUp ? anchor.top - MARGIN - 8 : vh - anchor.bottom - MARGIN - 8;
  const place = openUp
    ? { left, bottom: vh - anchor.top + 8 }
    : { left, top: anchor.bottom + 8 };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Deferred so the click that opened this doesn't immediately close it.
    const t = window.setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.clearTimeout(t);
    };
  }, [onClose]);

  const crewCount = phase.assigned_employee_ids?.length ?? 0;
  const label = "block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
  const action =
    "flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1.5 text-[11.5px] transition-colors";

  function toggleCrew(id: string) {
    setCrew((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={phase.name}
      className="fixed z-50 overflow-y-auto overscroll-contain rounded-2xl border bg-card shadow-2xl"
      style={{ width: WIDTH, maxHeight: Math.max(220, Math.min(room, 560)), ...place }}
    >
      <div className="sticky top-0 z-10 flex items-start gap-2 border-b bg-card px-3 py-2.5">
        <span
          className="mt-0.5 h-7 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: phase.color }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug">{phase.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              {pretty(phase.start_date)} – {pretty(phase.end_date)}
            </span>
            <span>·</span>
            <span>{spanDays(phase.start_date, phase.end_date)}d</span>
            {phase.is_confirmed && (
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <Lock className="h-3 w-3" />
                Firm{phase.confirmed_with ? ` · ${phase.confirmed_with}` : ""}
              </span>
            )}
            {crewCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {crewCount}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-lg border p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3 px-3 py-3">
        {issues.length > 0 && (
          <ul className="space-y-1">
            {issues.map((iss, i) => (
              <li key={i} className="flex items-start gap-2 text-[11.5px] leading-relaxed">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    iss.severity === "conflict" ? "bg-red-400" : "bg-amber-500"
                  }`}
                />
                <span className={iss.severity === "conflict" ? "text-red-300" : "text-amber-400"}>
                  {iss.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        {editing && onUpdatePhase ? (
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              onUpdatePhase(phase.id, {
                name: (fd.get("name") as string).trim(),
                start_date: fd.get("start") as string,
                end_date: fd.get("end") as string,
                notes: ((fd.get("notes") as string) || "").trim() || null,
                assigned_employee_ids: Array.from(crew),
              });
              setEditing(false);
            }}
          >
            <label className="block">
              <span className={label}>Phase name</span>
              <input
                name="name"
                required
                defaultValue={phase.name}
                className="mt-1 w-full rounded-lg border bg-background px-2.5 py-1.5 text-[12.5px]"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={label}>Start</span>
                <input
                  name="start"
                  type="date"
                  required
                  defaultValue={phase.start_date}
                  className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-[12px]"
                />
              </label>
              <label className="block">
                <span className={label}>End</span>
                <input
                  name="end"
                  type="date"
                  required
                  defaultValue={phase.end_date}
                  className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-[12px]"
                />
              </label>
            </div>
            <label className="block">
              <span className={label}>Notes</span>
              <textarea
                name="notes"
                rows={2}
                defaultValue={phase.notes ?? ""}
                className="mt-1 w-full resize-none rounded-lg border bg-background px-2.5 py-1.5 text-[12.5px]"
              />
            </label>
            {employees.length > 0 && (
              <div>
                <span className={label}>Crew</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {employees.map((e) => {
                    const on = crew.has(e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => toggleCrew(e.id)}
                        title={`${e.first_name} ${e.last_name}`}
                        className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                          on
                            ? "border border-amber-500/50 bg-amber-600/20 text-amber-300"
                            : "border border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {e.first_name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-amber-600 px-2 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-amber-700"
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <>
            {onStatusChange && (
              <label className="block">
                <span className={label}>Status</span>
                <select
                  value={phase.status}
                  onChange={(e) => onStatusChange(phase.id, e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-background px-2.5 py-1.5 text-[12.5px] text-foreground"
                >
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Done</option>
                  <option value="on_hold">On hold</option>
                </select>
              </label>
            )}

            {phase.notes && (
              <p className="rounded-lg bg-muted/40 px-2.5 py-2 text-[11.5px] text-muted-foreground">
                {phase.notes}
              </p>
            )}

            {predecessors.length > 0 && (
              <div>
                <span className={label}>Waits on</span>
                <ul className="mt-1 space-y-1">
                  {predecessors.map((l, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => onSelectPhase(l.fromId)}
                        className="w-full rounded-lg border px-2 py-1 text-left transition-colors hover:border-amber-500/50"
                      >
                        <span className="block truncate text-[11.5px] font-medium">
                          {nameOf(l.fromId)}
                        </span>
                        <span className="block text-[10.5px] text-muted-foreground">{l.reason}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {successors.length > 0 && (
              <div>
                <span className={`${label} flex items-center gap-1`}>
                  Holds up <ArrowRight className="h-3 w-3" />
                </span>
                <ul className="mt-1 space-y-1">
                  {successors.map((l, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => onSelectPhase(l.toId)}
                        className="w-full rounded-lg border px-2 py-1 text-left transition-colors hover:border-amber-500/50"
                      >
                        <span className="block truncate text-[11.5px] font-medium">
                          {nameOf(l.toId)}
                        </span>
                        <span className="block text-[10.5px] text-muted-foreground">{l.reason}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-3 gap-1.5 border-t pt-2.5">
              {onConfirmPhase && (
                <button
                  type="button"
                  onClick={() => onConfirmPhase(phase.id, Boolean(phase.is_confirmed))}
                  className={`${action} hover:text-foreground ${
                    phase.is_confirmed ? "text-emerald-400" : "text-muted-foreground"
                  }`}
                >
                  <Lock className="h-3 w-3" />
                  {phase.is_confirmed ? "Unlock" : "Confirm"}
                </button>
              )}
              {onUpdatePhase && (
                <button
                  type="button"
                  onClick={() => {
                    setCrew(new Set(phase.assigned_employee_ids ?? []));
                    setEditing(true);
                  }}
                  className={`${action} text-muted-foreground hover:text-foreground`}
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
              )}
              {onDeletePhase && (
                <button
                  type="button"
                  onClick={() => {
                    onDeletePhase(phase.id);
                    onClose();
                  }}
                  className={`${action} text-red-400 hover:text-red-300`}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              )}
            </div>

            {onOpenInList && (
              <button
                type="button"
                onClick={() => onOpenInList(phase.id)}
                className="w-full text-center text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                Open in the list
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
