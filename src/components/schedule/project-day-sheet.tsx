"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Send, ArrowRight, Loader2, ListChecks } from "lucide-react";
import Link from "next/link";
import type { WeekSchedulePhase } from "@/lib/actions/daily-logs";
import { listProjectOpenTodos } from "@/lib/actions/daily-logs";
import { DailyLogComposer } from "@/components/schedule/daily-log-composer";
import { PunchListVoiceComposer } from "@/components/projects/punch-list-voice-composer";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetBody,
} from "@/components/ui/bottom-sheet";

interface OpenTodo {
  id: string;
  description: string;
  priority: string | null;
  due_date: string | null;
}

/**
 * Detail sheet for a project on a given day. Shows the phases scheduled
 * for that day, the open todos for the project, and a "Log my work"
 * button per phase that opens the daily-log composer pre-tagged to that
 * phase.
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
  const [todos, setTodos] = useState<OpenTodo[]>([]);
  const [todosLoading, setTodosLoading] = useState(false);
  const [composerPhase, setComposerPhase] = useState<WeekSchedulePhase | null>(null);

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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTodosLoading(true);
    listProjectOpenTodos(projectId)
      .then((rows) => { if (!cancelled) setTodos(rows); })
      .catch(() => { /* non-critical */ })
      .finally(() => { if (!cancelled) setTodosLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId]);

  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent
          className="max-h-[88dvh]"
          // Same fix as the daily-log composer — don't auto-focus the
          // first input, otherwise opening this sheet pops the iOS
          // keyboard and hides the Log work / phase buttons.
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
                <ClipboardList className="h-3.5 w-3.5" />
                Open todos
              </h3>
              {todosLoading ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </div>
              ) : todos.length === 0 ? (
                <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-500">
                  No open todos for this project.
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {todos.map((t) => (
                    <li key={t.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-200">
                      <span>{t.description}</span>
                      {t.priority && t.priority !== "medium" && (
                        <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                          {t.priority}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <ListChecks className="h-3.5 w-3.5" />
                Punch list
              </h3>
              <PunchListVoiceComposer
                projectId={projectId}
                projectName={projectName}
                employees={projectCrew}
              />
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
