"use client";

import { useEffect, useState, useCallback } from "react";
import { Send, ArrowRight, Loader2, ListChecks, CalendarClock } from "lucide-react";
import Link from "next/link";
import type { WeekSchedulePhase, FeedPunchGroup } from "@/lib/actions/daily-logs";
import { listRecentProjectPunchGroups } from "@/lib/actions/daily-logs";
import { slipProjectSchedule } from "@/lib/actions/schedule-slip";
import { DailyLogComposer } from "@/components/schedule/daily-log-composer";
import { PunchListVoiceComposer } from "@/components/projects/punch-list-voice-composer";
import { PunchListGroupPost } from "@/components/field-feed/punch-list-group-post";
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
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  projectId: string;
  projectName: string;
  projectNumber: string;
  phases: WeekSchedulePhase[];
}) {
  const [punchGroups, setPunchGroups] = useState<FeedPunchGroup[]>([]);
  const [punchLoading, setPunchLoading] = useState(false);
  const [composerPhase, setComposerPhase] = useState<WeekSchedulePhase | null>(null);
  const [slipping, setSlipping] = useState<number | null>(null);
  const [slipResult, setSlipResult] = useState<string | null>(null);

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
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Today&apos;s phases
              </h3>
              <div className="flex flex-col gap-2">
                {phases.map((p) => (
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
                    </div>
                    <button
                      type="button"
                      onClick={() => setComposerPhase(p)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-500/15 border border-amber-500/40 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Log work
                    </button>
                  </div>
                ))}
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
          projectName={projectName}
          phaseName={composerPhase.name}
        />
      )}
    </>
  );
}
