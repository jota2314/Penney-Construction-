"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, ArrowRight, Loader2, ListChecks, CalendarClock, Lock, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import type { WeekSchedulePhase, FeedPunchGroup } from "@/lib/actions/daily-logs";
import type { Employee, Subcontractor } from "@/types/database";
import { listRecentProjectPunchGroups } from "@/lib/actions/daily-logs";
import { slipProjectSchedule } from "@/lib/actions/schedule-slip";
import { setPhaseConfirmation, getPhaseFormOptions, deleteSchedulePhase } from "@/lib/actions/schedule";
import { DailyLogComposer } from "@/components/schedule/daily-log-composer";
import { PhaseFormDialog } from "@/components/schedule/phase-form-dialog";
import { PunchListVoiceComposer } from "@/components/projects/punch-list-voice-composer";
import { PunchListGroupPost } from "@/components/field-feed/punch-list-group-post";
import {
  listActivityMentions,
  type ActivityMention,
} from "@/lib/actions/activity-mentions";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetBody,
} from "@/components/ui/bottom-sheet";

/**
 * Schedule project-day detail sheet. Tap a project card on the schedule
 * strip → this opens with: today's phases (with Log work buttons), the
 * project's recent punch-list groups (so saved items stay visible),
 * and the punch-list voice composer for adding more.
 *
 * The OPEN TODOS section was removed — it pulled all todos including
 * the punch-list category, which made saved punch items appear in the
 * wrong place. Office todos live on the dedicated todos page.
 */
export function ProjectDaySheet({
  open,
  onOpenChange,
  projectId,
  projectName,
  projectNumber,
  phases,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  projectId: string;
  projectName: string;
  projectNumber: string;
  phases: WeekSchedulePhase[];
  /** The day this sheet was opened for (yyyy-mm-dd) — pre-fills "Add work". */
  defaultDate?: string;
}) {
  const router = useRouter();
  const [punchGroups, setPunchGroups] = useState<FeedPunchGroup[]>([]);
  const [punchLoading, setPunchLoading] = useState(false);
  const [composerPhase, setComposerPhase] = useState<WeekSchedulePhase | null>(null);
  const [activityMentions, setActivityMentions] = useState<ActivityMention[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [slipping, setSlipping] = useState<number | null>(null);
  const [slipResult, setSlipResult] = useState<string | null>(null);

  // "Add work" → opens the same Add-phase form used on the project page.
  // The crew/sub lists aren't server-rendered here, so we lazy-load them the
  // first time the button is tapped.
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [formOptions, setFormOptions] = useState<{
    employees: Employee[];
    subcontractors: Subcontractor[];
  } | null>(null);

  const openAddWork = async () => {
    setAddLoading(true);
    try {
      if (!formOptions) {
        const opts = await getPhaseFormOptions();
        setFormOptions({
          employees: opts.employees as Employee[],
          subcontractors: opts.subcontractors as Subcontractor[],
        });
      }
      setAddOpen(true);
    } finally {
      setAddLoading(false);
    }
  };

  // Delete a phase right from the sheet. Confirm first — this also cancels
  // any synced Google Calendar event server-side. Deleted ids are hidden
  // locally so the row disappears instantly; router.refresh() syncs the strip.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const removePhase = async (phase: WeekSchedulePhase) => {
    const ok =
      typeof window === "undefined" ||
      window.confirm(`Delete "${phase.name}" from the schedule? This can't be undone.`);
    if (!ok) return;
    setDeletingId(phase.id);
    setDeleteError(null);
    const res = await deleteSchedulePhase(phase.id, projectId);
    setDeletingId(null);
    if (res.error) {
      setDeleteError(res.error);
      return;
    }
    setDeletedIds((prev) => new Set(prev).add(phase.id));
    router.refresh();
  };

  const visiblePhases = phases.filter((p) => !deletedIds.has(p.id));

  const slip = async (days: number) => {
    setSlipping(days);
    setSlipResult(null);
    const result = await slipProjectSchedule(projectId, days);
    setSlipping(null);
    if (result.error) {
      setSlipResult(`Slip failed: ${result.error}`);
      return;
    }
    setSlipResult(`Pushed ${result.shifted} phase${result.shifted === 1 ? "" : "s"} back ${days} day${days === 1 ? "" : "s"}.`);
  };

  // Confirm-with-sub: locks a phase's dates so it stops floating and shows as
  // confirmed on the board. Mirrored locally so the chip flips instantly; the
  // server action persists + revalidates.
  const [confirmMap, setConfirmMap] = useState<Record<string, { is_confirmed: boolean; confirmed_with: string | null }>>(
    () =>
      Object.fromEntries(
        phases.map((p) => [p.id, { is_confirmed: !!p.is_confirmed, confirmed_with: p.confirmed_with ?? null }]),
      ),
  );
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const confirmPhase = async (phaseId: string) => {
    const who =
      typeof window !== "undefined"
        ? window.prompt("Confirmed with which sub or crew? (optional)")?.trim() || null
        : null;
    setConfirmingId(phaseId);
    const res = await setPhaseConfirmation(phaseId, projectId, true, who);
    setConfirmingId(null);
    if (!res.error) {
      setConfirmMap((m) => ({ ...m, [phaseId]: { is_confirmed: true, confirmed_with: who } }));
      if (res.notify) {
        const parts: string[] = [];
        if (res.notify.emailed.length > 0) parts.push(`Emailed: ${res.notify.emailed.join(", ")}`);
        if (res.notify.skipped.length > 0) parts.push(`No email on file: ${res.notify.skipped.join(", ")}`);
        if (res.notify.error) parts.push(res.notify.error);
        setSlipResult(parts.length > 0 ? parts.join(" · ") : "Phase is live.");
      }
    } else {
      setSlipResult(res.error);
    }
  };

  const unconfirmPhase = async (phaseId: string) => {
    setConfirmingId(phaseId);
    const res = await setPhaseConfirmation(phaseId, projectId, false);
    setConfirmingId(null);
    if (!res.error) {
      setConfirmMap((m) => ({ ...m, [phaseId]: { is_confirmed: false, confirmed_with: null } }));
    }
  };

  // Dedupe crew members across all of today's phases so a worker who's
  // on two phases doesn't appear twice in the assignee dropdowns.
  const projectCrew = (() => {
    const map = new Map<string, { id: string; first_name: string; last_name: string }>();
    for (const p of phases) {
      for (const c of p.crew) {
        if (!map.has(c.id)) map.set(c.id, { id: c.id, first_name: c.first_name, last_name: c.last_name });
      }
    }
    return Array.from(map.values());
  })();

  const loadPunch = useCallback(async () => {
    setPunchLoading(true);
    try {
      const rows = await listRecentProjectPunchGroups(projectId, 4);
      setPunchGroups(rows);
    } catch {
      /* non-critical */
    } finally {
      setPunchLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPunchLoading(true);
    listRecentProjectPunchGroups(projectId, 4)
      .then((rows) => { if (!cancelled) setPunchGroups(rows); })
      .catch(() => { /* non-critical */ })
      .finally(() => { if (!cancelled) setPunchLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId]);

  useEffect(() => {
    if (!composerPhase) return;
    let cancelled = false;
    listActivityMentions(projectId, { includeEveryone: true })
      .then((rows) => {
        if (!cancelled) setActivityMentions(rows);
      })
      .catch(() => {
        if (!cancelled) setActivityMentions([]);
      })
      .finally(() => {
        if (!cancelled) setMentionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [composerPhase, projectId]);

  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent
          className="max-h-[88dvh]"
          // Don't auto-focus the first input — that pops the iOS
          // keyboard and hides the buttons below.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <BottomSheetHeader>
            <div className="flex items-baseline justify-between gap-3">
              <BottomSheetTitle>{projectName}</BottomSheetTitle>
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{projectNumber}</span>
            </div>
          </BottomSheetHeader>
          <BottomSheetBody className="flex flex-col gap-5">
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Today&apos;s phases
                </h3>
                <button
                  type="button"
                  onClick={openAddWork}
                  disabled={addLoading}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                >
                  {addLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add work
                </button>
              </div>
              {visiblePhases.length === 0 && (
                <p className="mb-2 rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-xs text-zinc-500">
                  No work scheduled for this day. Tap <span className="text-amber-300">Add work</span> to schedule a phase.
                </p>
              )}
              {deleteError && (
                <p className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                  {deleteError}
                </p>
              )}
              <div className="flex flex-col gap-2">
                {visiblePhases.map((p) => {
                  const cf = confirmMap[p.id] ?? {
                    is_confirmed: !!p.is_confirmed,
                    confirmed_with: p.confirmed_with ?? null,
                  };
                  return (
                  <div
                    key={p.id}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 flex items-start gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-zinc-100">{p.name}</div>
                      {p.line_item_description && (
                        <div className="text-xs text-zinc-400 mt-0.5">{p.line_item_description}</div>
                      )}
                      {p.crew.length > 0 && (
                        <div className="text-[11px] text-zinc-500 mt-1.5">
                          Crew: {p.crew.map((c) => `${c.first_name} ${c.last_name}`).join(", ")}
                        </div>
                      )}
                      <div className="mt-2">
                        {cf.is_confirmed ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                            <Lock className="h-3 w-3" />
                            Confirmed{cf.confirmed_with ? ` · ${cf.confirmed_with}` : ""}
                            <button
                              type="button"
                              onClick={() => unconfirmPhase(p.id)}
                              disabled={confirmingId === p.id}
                              className="ml-0.5 text-emerald-400/70 hover:text-emerald-200 disabled:opacity-50"
                              aria-label="Unconfirm"
                            >
                              ×
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => confirmPhase(p.id)}
                            disabled={confirmingId === p.id}
                            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-zinc-600 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-50"
                          >
                            {confirmingId === p.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Lock className="h-3 w-3" />
                            )}
                            Tentative — confirm with sub
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setMentionsLoading(true);
                          setComposerPhase(p);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 border border-amber-500/40 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Log work
                      </button>
                      <button
                        type="button"
                        onClick={() => removePhase(p)}
                        disabled={deletingId === p.id}
                        aria-label={`Delete ${p.name}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                      >
                        {deletingId === p.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <ListChecks className="h-3.5 w-3.5" />
                Punch list
              </h3>

              {punchLoading ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </div>
              ) : punchGroups.length > 0 ? (
                <div className="flex flex-col gap-2 mb-3">
                  {punchGroups.map((g) => (
                    <PunchListGroupPost key={g.session_id} group={g} />
                  ))}
                </div>
              ) : null}

              <PunchListVoiceComposer
                projectId={projectId}
                projectName={projectName}
                employees={projectCrew}
                onCreated={loadPunch}
              />
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                Slip schedule
              </h3>
              <p className="text-[11px] text-zinc-500 mb-2">
                Crew falling behind? Push every not-yet-done phase on this project forward.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 7].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => slip(d)}
                    disabled={slipping !== null}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-50"
                  >
                    {slipping === d ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    +{d} {d === 7 ? "wk" : "day"}{d > 1 && d !== 7 ? "s" : ""}
                  </button>
                ))}
              </div>
              {slipResult && (
                <p className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-300">
                  {slipResult}
                </p>
              )}
            </section>

            <Link
              href={`/projects/${projectId}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
              onClick={() => onOpenChange(false)}
            >
              Open project
              <ArrowRight className="h-4 w-4" />
            </Link>
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>

      {composerPhase && (
        <DailyLogComposer
          open={!!composerPhase}
          onOpenChange={(next) => { if (!next) setComposerPhase(null); }}
          phaseId={composerPhase.id}
          projectId={projectId}
          projectName={projectName}
          phaseName={composerPhase.name}
          mentions={activityMentions}
          mentionsLoading={mentionsLoading}
        />
      )}

      {addOpen && formOptions && (
        <PhaseFormDialog
          open={addOpen}
          onOpenChange={(next) => {
            setAddOpen(next);
            // Re-fetch so the new phase shows on the schedule/command center
            // without a hard reload.
            if (!next) router.refresh();
          }}
          projectId={projectId}
          employees={formOptions.employees}
          subcontractors={formOptions.subcontractors}
          defaultDate={defaultDate}
        />
      )}
    </>
  );
}
