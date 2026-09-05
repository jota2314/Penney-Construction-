"use client";

import { useRef, useState } from "react";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { BottomSheet, BottomSheetContent, BottomSheetTitle, BottomSheetBody } from "@/components/ui/bottom-sheet";
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

export type PhaseMutationResult = void | boolean | "cancelled" | Promise<void | boolean | "cancelled">;

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
  displayedDates,
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
  /** Effective chart dates; edits still start from the saved dates. */
  displayedDates?: { start: string; end: string };
  issues: SequenceIssue[];
  predecessors: PhaseLink[];
  successors: PhaseLink[];
  nameOf: (id: string) => string;
  employees: PopupEmployee[];
  onSelectPhase: (id: string) => void;
  onClose: () => void;
  onStatusChange?: (id: string, status: string) => PhaseMutationResult;
  onConfirmPhase?: (id: string, currentlyConfirmed: boolean) => PhaseMutationResult;
  onUpdatePhase?: (id: string, patch: PhasePatch) => PhaseMutationResult;
  onDeletePhase?: (id: string) => PhaseMutationResult;
  onOpenInList?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { height: visibleHeight } = useKeyboardInset();
  const [editing, setEditing] = useState(false);
  const [crew, setCrew] = useState<Set<string>>(new Set(phase.assigned_employee_ids ?? []));

  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const start = displayedDates?.start ?? phase.start_date;
  const end = displayedDates?.end ?? phase.end_date;
  const shifted = start !== phase.start_date || end !== phase.end_date;

  async function mutate(run: () => PhaseMutationResult, success?: () => void) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await run();
      if (result === "cancelled") return;
      if (result === false) {
        setError("The change was not saved. Check the details and try again.");
      } else {
        success?.();
      }
    } catch {
      setError("Could not save the change. Please try again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const crewCount = phase.assigned_employee_ids?.length ?? 0;
  const label = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const action =
    "flex items-center justify-center gap-1.5 min-h-11 rounded-xl border px-2 py-2 text-sm transition-colors";

  function toggleCrew(id: string) {
    setCrew((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <BottomSheet open onOpenChange={(open) => { if (!open && !pendingRef.current) onClose(); }}>
    <BottomSheetContent
      ref={ref}
      showCloseButton={false}
      maxHeight={`calc(${visibleHeight > 0 ? `${visibleHeight}px` : "100dvh"} - max(env(safe-area-inset-top, 0px), 48px) - 12px)`}
      aria-describedby={undefined}
      className="bg-card"
      onOpenAutoFocus={(event) => { event.preventDefault(); ref.current?.focus(); }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        document.getElementById(`gantt-row-${phase.id}`)?.focus({ preventScroll: true });
      }}
    >
      <div className="shrink-0 flex items-start gap-3 border-b bg-card px-4 py-4">
        <span
          className="mt-0.5 h-7 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: phase.color }}
        />
        <div className="min-w-0 flex-1">
          <BottomSheetTitle className="break-words pr-0 leading-snug">{phase.name}</BottomSheetTitle>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {pretty(start)} – {pretty(end)}
            </span>
            <span>·</span>
            <span>{spanDays(start, end)} days</span>
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
          disabled={pending}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <BottomSheetBody className="space-y-4 overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
        {shifted && <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">Projected dates after earlier delays. Saved dates: {pretty(phase.start_date)} - {pretty(phase.end_date)}.</p>}
        {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-60" aria-busy={pending}>
        {issues.length > 0 && (
          <ul className="space-y-1">
            {issues.map((iss, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
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
              const name = String(fd.get("name") ?? "").trim();
              const startDate = String(fd.get("start") ?? "");
              const endDate = String(fd.get("end") ?? "");
              if (!name || endDate < startDate) {
                setError(!name ? "Enter a phase name." : "End date must be on or after the start date.");
                return;
              }
              void mutate(() => onUpdatePhase(phase.id, {
                name: (fd.get("name") as string).trim(),
                start_date: fd.get("start") as string,
                end_date: fd.get("end") as string,
                notes: ((fd.get("notes") as string) || "").trim() || null,
                assigned_employee_ids: Array.from(crew),
              }), () => setEditing(false));
            }}
          >
            <label className="block">
              <span className={label}>Phase name</span>
              <input
                name="name"
                required
                defaultValue={phase.name}
                className="mt-1 min-h-11 min-w-0 w-full rounded-lg border bg-background px-2.5 py-1.5 text-base sm:text-sm"
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
                  className="mt-1 min-h-11 min-w-0 w-full rounded-lg border bg-background px-2 py-1.5 text-base sm:text-sm"
                />
              </label>
              <label className="block">
                <span className={label}>End</span>
                <input
                  name="end"
                  type="date"
                  required
                  defaultValue={phase.end_date}
                  className="mt-1 min-h-11 min-w-0 w-full rounded-lg border bg-background px-2 py-1.5 text-base sm:text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className={label}>Notes</span>
              <textarea
                name="notes"
                rows={2}
                defaultValue={phase.notes ?? ""}
                className="mt-1 w-full resize-none rounded-lg border bg-background px-2.5 py-1.5 text-base sm:text-sm"
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
                        aria-pressed={on}
                        title={`${e.first_name} ${e.last_name}`}
                        className={`min-h-11 rounded-full px-3 py-2 text-sm transition ${
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
                onClick={() => { setEditing(false); setError(null); }}
                className="min-h-11 rounded-lg border px-2 py-1.5 text-base sm:text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-11 rounded-lg bg-amber-600 px-2 py-1.5 text-base sm:text-sm font-medium text-white transition-colors hover:bg-amber-700"
              >
                {pending ? "Saving..." : "Save changes"}
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
                  onChange={(e) => { const status = e.target.value; void mutate(() => onStatusChange(phase.id, status)); }}
                  className="mt-1 min-h-11 min-w-0 w-full rounded-lg border bg-background px-2.5 py-1.5 text-base sm:text-sm text-foreground"
                >
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Done</option>
                  <option value="on_hold">On hold</option>
                </select>
              </label>
            )}

            {phase.notes && (
              <p className="rounded-lg bg-muted/40 px-2.5 py-2 text-sm text-muted-foreground">
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
                        className="min-h-11 w-full rounded-xl border px-3 py-2 text-left transition-colors hover:border-amber-500/50"
                      >
                        <span className="block break-words text-sm font-medium">
                          {nameOf(l.fromId)}
                        </span>
                        <span className="block text-xs text-muted-foreground">{l.reason}</span>
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
                        className="min-h-11 w-full rounded-xl border px-3 py-2 text-left transition-colors hover:border-amber-500/50"
                      >
                        <span className="block break-words text-sm font-medium">
                          {nameOf(l.toId)}
                        </span>
                        <span className="block text-xs text-muted-foreground">{l.reason}</span>
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
                  onClick={() => {
                    if (phase.is_confirmed) {
                      void mutate(() => onConfirmPhase(phase.id, true));
                    } else {
                      onClose();
                      onConfirmPhase(phase.id, false);
                    }
                  }}
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
                    setError(null);
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
                    void mutate(() => onDeletePhase(phase.id), onClose);
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
                className="min-h-11 w-full text-center text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                Open in the list
              </button>
            )}
          </>
        )}
        </fieldset>
      </BottomSheetBody>
    </BottomSheetContent>
    </BottomSheet>
  );
}
