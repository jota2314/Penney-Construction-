"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { BoardJob, BoardStep } from "@/lib/board/board-data";
import {
  applyScheduleUpdate,
  suggestStepAnswers,
  type ScheduleAnswer,
  type StepSuggestion,
} from "@/lib/actions/board-update";

/**
 * Update one job's schedule without opening the timeline.
 *
 * Steps past their end date each get one answer: done, still going, or not
 * started. The field logs pre-fill an answer where they can. Upcoming steps
 * are shown as planned and can be moved. "Confirm schedule" saves it all and
 * stamps the job with who confirmed and when.
 */

type PickKind = "done" | "going" | "not_started" | "move";

interface Draft {
  pick: PickKind;
  /** End date for "going"; start date for "not_started" and "move". */
  date?: string;
  /** True until the person changes what the logs suggested. */
  suggested?: boolean;
}

function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** `days` ahead of `from`, rolled forward off a weekend. */
function workday(from: string, days: number) {
  let out = shift(from, days);
  const dow = () => new Date(`${out}T12:00:00`).getDay();
  while (dow() === 0 || dow() === 6) out = shift(out, 1);
  return out;
}

/** "Thu 11/12" */
function fmtDay(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getMonth() + 1}/${d.getDate()}`;
}

/** A timestamp as an Eastern calendar day, e.g. "Wed 11/11". */
export function fmtStamp(at: string) {
  return new Date(at)
    .toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "America/New_York" })
    .replace(",", "");
}

function fmtRange(step: BoardStep) {
  return step.startDate === step.endDate ? fmtDay(step.startDate) : `${fmtDay(step.startDate)} to ${fmtDay(step.endDate)}`;
}

export function BoardUpdateSheet({
  job,
  todayStr,
  onClose,
  onSaved,
  onAddStep,
}: {
  job: BoardJob;
  todayStr: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  onAddStep: (projectId: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [suggestions, setSuggestions] = useState<Record<string, StepSuggestion>>({});
  const [reading, setReading] = useState(job.staleSteps.length > 0);
  const [pushLater, setPushLater] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  /** One read of the logs per open sheet, however often the board refreshes under it. */
  const asked = useRef(false);

  const defaultDate = (pick: PickKind) => (pick === "going" ? workday(todayStr, 2) : workday(todayStr, 1));

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // What the field logs say about each stale step. Only fills steps the
  // person hasn't answered yet.
  useEffect(() => {
    if (!job.staleSteps.length || asked.current) return;
    asked.current = true;
    void suggestStepAnswers(job.id)
      .then((found) => {
        if (!alive.current) return;
        setSuggestions(found);
        setDrafts((prev) => {
          const next = { ...prev };
          for (const step of job.staleSteps) {
            const s = found[step.id];
            if (!s || next[step.id]) continue;
            // An inspection is passed or not yet; "still going" doesn't apply.
            const pick: PickKind = step.isInspection && s.pick === "going" ? "not_started" : s.pick;
            next[step.id] = {
              pick,
              date: pick === "done" ? undefined : pick === "going" ? workday(todayStr, 2) : workday(todayStr, 1),
              suggested: true,
            };
          }
          return next;
        });
      })
      .catch(() => {
        // The sheet works without suggestions.
      })
      .finally(() => {
        if (alive.current) setReading(false);
      });
  }, [job.id, job.staleSteps, todayStr]);

  const choose = (step: BoardStep, pick: PickKind) => {
    setError(null);
    setDrafts((prev) => ({
      ...prev,
      [step.id]: { pick, date: pick === "done" ? undefined : (prev[step.id]?.pick === pick && prev[step.id]?.date) || defaultDate(pick) },
    }));
  };

  const setDate = (step: BoardStep, date: string) => {
    setError(null);
    setDrafts((prev) => (prev[step.id] ? { ...prev, [step.id]: { ...prev[step.id], date, suggested: false } } : prev));
  };

  const clear = (step: BoardStep) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[step.id];
      return next;
    });
  };

  const unanswered = job.staleSteps.filter((s) => !drafts[s.id]).length;
  const steps = useMemo(() => [...job.staleSteps, ...job.upcomingSteps], [job.staleSteps, job.upcomingSteps]);
  /** A step moving later is what "push later steps" hangs off. */
  const movesLater = steps.some((s) => {
    const d = drafts[s.id];
    return (d?.pick === "not_started" || d?.pick === "move") && !!d.date && d.date > s.startDate;
  });

  const confirm = async () => {
    if (saving) return;
    if (unanswered > 0) {
      setError(`Answer the ${unanswered} step${unanswered === 1 ? "" : "s"} above first.`);
      return;
    }
    const answers: ScheduleAnswer[] = [];
    for (const step of steps) {
      const d = drafts[step.id];
      if (!d) continue;
      if (d.pick === "done") answers.push({ id: step.id, kind: "done" });
      else if (!d.date) {
        setError(`Pick a date for "${step.name}".`);
        return;
      } else if (d.pick === "going") answers.push({ id: step.id, kind: "going", end: d.date });
      else if (d.pick === "not_started") answers.push({ id: step.id, kind: "not_started", start: d.date });
      else if (d.date !== step.startDate) answers.push({ id: step.id, kind: "move", start: d.date });
    }
    setSaving(true);
    setError(null);
    try {
      const res = await applyScheduleUpdate({ projectId: job.id, answers, pushLater: pushLater && movesLater });
      if (res.error) {
        setError(res.error);
        return;
      }
      const bits = [
        res.changed ? `${res.changed} step${res.changed === 1 ? "" : "s"} updated` : null,
        res.pushed ? `${res.pushed} pushed later` : null,
        res.emailed ? `${res.emailed} emailed` : null,
      ].filter(Boolean);
      onSaved(`${job.name} confirmed${bits.length ? ` · ${bits.join(" · ")}` : ""}`);
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && !saving && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="space-y-0 border-b border-border px-5 pt-5 pb-4">
          <SheetTitle className="pr-8 text-lg leading-snug">{job.name}</SheetTitle>
          <SheetDescription className="pt-0.5 text-sm">
            {job.pm ? `${job.pm.name} · ` : ""}
            {job.staleSteps.length
              ? `${job.staleSteps.length} step${job.staleSteps.length === 1 ? "" : "s"} to check`
              : "Nothing past its date"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {job.staleSteps.length > 0 && (
            <section aria-label="Steps past their end date">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Past the end date</h3>
                {reading && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Reading the field logs
                  </span>
                )}
              </div>
              <ul className="mt-2 divide-y divide-border">
                {job.staleSteps.map((step) => {
                  const d = drafts[step.id];
                  const hint = suggestions[step.id];
                  return (
                    <li key={step.id} className="py-3">
                      <p className="text-sm font-medium leading-snug">{step.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Planned {fmtRange(step)}
                        {step.who.length ? ` · ${step.who.join(", ")}` : ""}
                      </p>
                      {hint?.why && (
                        <p className="mt-1 flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                          {hint.why}
                        </p>
                      )}
                      <div className={cn("mt-2 grid gap-2", step.isInspection ? "grid-cols-2" : "grid-cols-3")}>
                        <Choice active={d?.pick === "done"} onClick={() => choose(step, "done")}>
                          {step.isInspection ? "Passed" : "Done"}
                        </Choice>
                        {!step.isInspection && (
                          <Choice active={d?.pick === "going"} onClick={() => choose(step, "going")}>
                            Still going
                          </Choice>
                        )}
                        <Choice active={d?.pick === "not_started"} onClick={() => choose(step, "not_started")}>
                          {step.isInspection ? "Not yet" : "Not started"}
                        </Choice>
                      </div>
                      {(d?.pick === "going" || d?.pick === "not_started") && (
                        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          {d.pick === "going" ? "Ends" : step.isInspection ? "New date" : "New start"}
                          <input
                            type="date"
                            value={d.date ?? ""}
                            min={todayStr}
                            onChange={(e) => setDate(step, e.target.value)}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                          />
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section aria-label="Coming up" className={cn(job.staleSteps.length > 0 && "mt-5")}>
            <h3 className="text-sm font-semibold">Coming up</h3>
            {job.upcomingSteps.length === 0 ? (
              <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-sm">
                <p>Nothing is planned for the next ten days.</p>
                <Button variant="outline" size="sm" className="mt-2 h-9" onClick={() => onAddStep(job.id)}>
                  <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden />
                  Add the next step
                </Button>
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {job.upcomingSteps.map((step) => {
                  const d = drafts[step.id];
                  const moving = d?.pick === "move";
                  return (
                    <li key={step.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="text-sm leading-snug">{step.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtRange(step)}
                          {step.who.length ? ` · ${step.who.join(", ")}` : ""}
                        </p>
                      </div>
                      {moving ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            type="date"
                            aria-label={`New start for ${step.name}`}
                            value={d.date ?? step.startDate}
                            onChange={(e) => setDate(step, e.target.value)}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          />
                          <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => clear(step)}>
                            Keep
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9"
                          onClick={() => setDrafts((prev) => ({ ...prev, [step.id]: { pick: "move", date: step.startDate } }))}
                        >
                          Move
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {movesLater && (
            <label className="mt-4 flex items-start gap-2 rounded-md border border-border px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={pushLater}
                onChange={(e) => setPushLater(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-amber-600"
              />
              <span>
                Push the later steps by the same days
                <span className="block text-xs text-muted-foreground">
                  Everything still open after the first moved step slides with it.
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="border-t border-border px-5 py-3">
          {error && <p className="mb-2 text-sm text-red-500">{error}</p>}
          <Button className="h-11 w-full text-base" onClick={() => void confirm()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Check className="mr-2 h-4 w-4" aria-hidden />}
            {saving ? "Saving" : "Confirm schedule"}
          </Button>
          <p className="mt-1.5 text-center text-xs text-muted-foreground">
            {job.confirmed
              ? `Last confirmed ${fmtStamp(job.confirmed.at)} by ${job.confirmed.by}`
              : "Nobody has confirmed this job's schedule yet"}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-10 rounded-md border px-2 text-sm font-medium",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
