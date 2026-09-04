"use client";

import { Camera, ChevronRight, Clock, FileUp } from "lucide-react";
import type { FieldData, JobRollup, Phase, Project, ScheduleAction, Tab } from "./types";
import { PhaseCard } from "./schedule-tab";
import { Card, MONO, Pill, SectionLabel, StatTile, btnGhost, btnPrimary, fmt, fmtClock, fmtShortDate, useNow } from "./ui";

/**
 * Home: the one screen a sub needs before a day starts. Where am I due,
 * one tap into today's daily log, what's awarded, what's owed.
 */
export function HomeTab({
  firstName,
  jobs,
  allJobs,
  upcoming,
  projectById,
  field,
  clockBusy,
  onClockIn,
  onClockOut,
  onGo,
  onOpenJob,
  onDailyLog,
  scheduleBusy,
  onSchedule,
}: {
  firstName: string;
  jobs: JobRollup[];
  allJobs: JobRollup[];
  upcoming: Phase[];
  projectById: Map<string, Project>;
  field: FieldData | null;
  clockBusy: boolean;
  onClockIn: (projectId: string) => void;
  onClockOut: () => void;
  onGo: (tab: Tab) => void;
  onOpenJob: (projectId: string) => void;
  /** Open a job's log screen (photos, inspections, feed). null = the job list. */
  onDailyLog: (projectId: string | null) => void;
  scheduleBusy: string | null;
  onSchedule: (a: ScheduleAction) => void;
}) {
  const awardedTotal = jobs.reduce((s, j) => s + j.agreed, 0);
  const openTotal = allJobs.reduce((s, j) => s + j.billing.open, 0);
  const awaiting = allJobs.reduce((s, j) => s + j.pendingPrice, 0);
  const next = upcoming[0] ?? null;
  const nextProj = next ? projectById.get(next.project_id) : null;
  const awardedJobs = jobs.filter((j) => j.agreed > 0);
  // Dates the office is waiting on him for — shown first, before anything else.
  const waiting = upcoming.filter((p) => p.is_confirmed && !p.sub_response && !p.mine);

  const now = useNow();
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Today's job: where he's clocked in, else the job scheduled today, else
  // the next scheduled one, else the first live job.
  const today = new Date(now).toISOString().slice(0, 10);
  const todayPhase = upcoming.find((p) => p.start_date && p.start_date <= today && (!p.end_date || p.end_date >= today));
  const todayJob =
    (field?.clock && field.jobs.find((j) => j.id === field.clock!.project_id)) ||
    (todayPhase && field?.jobs.find((j) => j.id === todayPhase.project_id)) ||
    (next && field?.jobs.find((j) => j.id === next.project_id)) ||
    field?.jobs[0] ||
    null;

  const elapsed = field?.clock
    ? Math.max(0, (now - new Date(field.clock.started_at).getTime()) / 3_600_000)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[13px] text-stone-500">{greeting}{firstName ? `, ${firstName}` : ""}.</p>
        <p className="mt-0.5 text-[15px] text-stone-300">
          {jobs.length === 0
            ? "No active jobs right now."
            : `${jobs.length} active job${jobs.length === 1 ? "" : "s"}${
                next ? ` · next up ${fmtShortDate(next.start_date)}` : ""
              }`}
        </p>
      </div>

      {/* dates waiting on his answer */}
      {waiting.length > 0 && (
        <section>
          <SectionLabel>Waiting on you</SectionLabel>
          <div className="space-y-2.5">
            {waiting.slice(0, 3).map((p) => (
              <PhaseCard key={p.id} p={p} proj={projectById.get(p.project_id)} today={today} busy={scheduleBusy} onAction={onSchedule} compact />
            ))}
            {waiting.length > 3 && (
              <button onClick={() => onGo("schedule")} className="text-[11px] uppercase tracking-[0.14em] text-amber-500/90" style={MONO}>
                {waiting.length - 3} more on Schedule →
              </button>
            )}
          </div>
        </section>
      )}

      {/* today's job — the daily log is the thing, the clock rides along */}
      {field && todayJob && (
        <Card tone={field.clock ? "emerald" : "amber"} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p
                className={`text-[10px] uppercase tracking-[0.24em] ${field.clock ? "text-emerald-400" : "text-stone-500"}`}
                style={MONO}
              >
                {field.clock ? `On the clock · ${elapsed.toFixed(1)} h · since ${fmtClock(field.clock.started_at)}` : "Today"}
              </p>
              <p className="mt-1 truncate text-[17px] font-semibold text-stone-100">{todayJob.name}</p>
              {todayJob.address && (
                <p className="truncate text-[12px] text-stone-500" style={MONO}>{todayJob.address}</p>
              )}
            </div>
            {field.jobs.length > 1 && (
              <button
                onClick={() => onDailyLog(null)}
                className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-stone-400"
                style={MONO}
              >
                Different job
              </button>
            )}
          </div>
          <div className="mt-3.5 grid grid-cols-[1fr_auto] gap-2">
            <button onClick={() => onDailyLog(todayJob.id)} className={`${btnPrimary} py-3.5 text-[13px]`}>
              <Camera className="h-5 w-5" />
              Daily log
            </button>
            {field.clock ? (
              <button onClick={onClockOut} disabled={clockBusy} className={`${btnGhost} px-4`}>
                <Clock className="h-4 w-4" />
                {clockBusy ? "…" : "Clock out"}
              </button>
            ) : (
              <button onClick={() => onClockIn(todayJob.id)} disabled={clockBusy} className={`${btnGhost} px-4`}>
                <Clock className="h-4 w-4" />
                {clockBusy ? "…" : "Clock in"}
              </button>
            )}
          </div>
        </Card>
      )}

      {/* numbers */}
      <div className="grid grid-cols-2 gap-2.5">
        <StatTile
          label="Awarded to you"
          value={fmt(awardedTotal)}
          hint={`${awardedJobs.length} active job${awardedJobs.length === 1 ? "" : "s"}`}
          tone="amber"
          onClick={() => onGo("jobs")}
        />
        <StatTile
          label="Owed to you"
          value={fmt(openTotal)}
          hint={openTotal > 0.5 ? "Open invoices" : "All paid up"}
          tone={openTotal > 0.5 ? "amber" : "emerald"}
          onClick={() => onGo("money")}
        />
      </div>

      {/* next up */}
      <section>
        <SectionLabel
          right={
            upcoming.length > 1 ? (
              <button onClick={() => onGo("schedule")} className="text-[10px] uppercase tracking-[0.2em] text-amber-500/90" style={MONO}>
                All dates →
              </button>
            ) : undefined
          }
        >
          Next up
        </SectionLabel>
        {next ? (
          <PhaseCard p={next} proj={nextProj ?? undefined} today={today} busy={scheduleBusy} onAction={onSchedule} />
        ) : (
          <Card className="p-4">
            <p className="text-[13px] text-stone-500">
              Nothing booked yet. We&apos;ll add you when your next phase is scheduled.
            </p>
          </Card>
        )}
      </section>

      {/* awarded jobs — tap the row for the money, the camera for the log */}
      {awardedJobs.length > 0 && (
        <section>
          <SectionLabel>Your awarded work</SectionLabel>
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
            {awardedJobs.map((j, i) => (
              <div
                key={j.proj.id}
                className={`flex w-full items-center gap-2 pl-4 pr-2 transition-colors hover:bg-white/[0.03] ${
                  i > 0 ? "border-t border-white/[0.06]" : ""
                }`}
              >
                <button onClick={() => onOpenJob(j.proj.id)} className="flex min-w-0 flex-1 items-center gap-3 py-3.5 text-left">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-stone-100">{j.proj.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500" style={MONO}>
                      <span>{j.proj.project_number}</span>
                      {j.billing.paid > 0 && <span>· paid {fmt(j.billing.paid)}</span>}
                      {j.billing.open > 0.5 && <span className="text-amber-400">· open {fmt(j.billing.open)}</span>}
                    </p>
                  </div>
                  <p className="shrink-0 text-[14px] font-semibold text-amber-400" style={MONO}>{fmt(j.agreed)}</p>
                  <ChevronRight className="h-4 w-4 shrink-0 text-stone-600" />
                </button>
                <button
                  onClick={() => onDailyLog(j.proj.id)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 text-stone-300 hover:border-amber-500/40 hover:text-amber-400"
                  aria-label={`Daily log for ${j.proj.name}`}
                >
                  <Camera className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {awaiting > 0 && (
        <Card className="flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-[13px] text-stone-400">
            {awaiting} price{awaiting === 1 ? "" : "s"} in with us, not awarded yet.
          </p>
          <Pill tone="neutral">Under review</Pill>
        </Card>
      )}

      {/* quick actions */}
      {field && field.jobs.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={() => onDailyLog(null)} className={btnGhost}>
            <Camera className="h-4 w-4" /> All job logs
          </button>
          <button onClick={() => onGo("money")} className={btnGhost}>
            <FileUp className="h-4 w-4" /> Send invoice
          </button>
        </div>
      )}
    </div>
  );
}
