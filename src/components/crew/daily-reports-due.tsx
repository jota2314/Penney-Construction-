"use client";

import { useState } from "react";
import { ArrowRight, ClipboardList, Clock3 } from "lucide-react";
import { v } from "@/components/field-feed/tokens";
import type { PendingDailyReport } from "@/lib/crew/pending-reports";
import { DailyLogComposer } from "@/components/schedule/daily-log-composer";
import { scheduleDateLabel } from "@/lib/crew/schedule-dates";

export function DailyReportsDue({ reports, unavailable }: { reports: PendingDailyReport[]; unavailable: boolean }) {
  const [selected, setSelected] = useState<PendingDailyReport | null>(null);
  if (unavailable) return <p role="alert">Daily logs could not be loaded. Refresh before clocking in.</p>;
  if (!reports.length) return null;
  return <section className="overflow-hidden rounded-2xl border" style={{ background: v("card"), borderColor: "rgba(217,119,6,0.25)" }}>
    <div className="flex items-start gap-3 px-4 pt-4 pb-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10" style={{ color: v("accent") }}><ClipboardList className="h-[18px] w-[18px]" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2"><h2 className="text-[15px] font-semibold">Daily logs due</h2><span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold" style={{ color: v("accent") }}>{reports.length} to finish</span></div>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: v("quiet") }}>Time saved. Add your day’s update.</p>
      </div>
    </div>
    {reports.map(report => <button type="button" key={report.logId} onClick={() => setSelected(report)} aria-label={`Write daily log for ${report.projectName}, ${report.workDate}`} className="group block w-full border-t px-4 py-3.5 text-left transition hover:bg-amber-500/5 active:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500" style={{ borderColor: v("line") }}>
      <span className="block text-sm font-semibold leading-snug">{report.projectName}</span>
      <span className="mt-2 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-xs" style={{ color: v("quiet") }}><Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{scheduleDateLabel(report.workDate, { month: "short", day: "numeric" })} · {report.minutes >= 60 ? `${Math.floor(report.minutes / 60)}h ${report.minutes % 60}m` : `${report.minutes} min`}</span>
        <span className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-3 text-xs font-semibold text-zinc-950">Write log<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
      </span>
      {report.overdue && <span className="mt-1 block text-xs text-amber-500">Required before your next clock-in</span>}
    </button>)}
    {!reports.some(report => report.overdue) && <p className="px-4 pb-3 text-[11px]" style={{ color: v("quiet") }}>Finish before your next workday.</p>}
    {selected && <DailyLogComposer key={selected.logId} open onOpenChange={open => { if (!open) setSelected(null); }}
      projectId={selected.projectId} projectName={selected.projectName} report={selected} />}
  </section>;
}
