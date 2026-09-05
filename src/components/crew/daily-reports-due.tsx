"use client";

import { useState } from "react";
import type { PendingDailyReport } from "@/lib/crew/pending-reports";
import { DailyLogComposer } from "@/components/schedule/daily-log-composer";
import { scheduleDateLabel } from "@/lib/crew/schedule-dates";

export function DailyReportsDue({ reports, unavailable }: { reports: PendingDailyReport[]; unavailable: boolean }) {
  const [selected, setSelected] = useState<PendingDailyReport | null>(null);
  if (unavailable) return <p role="alert">Daily logs could not be loaded. Refresh before clocking in.</p>;
  if (!reports.length) return null;
  return <section className="rounded-2xl border border-amber-500/40 p-4 space-y-3">
    <h2 className="font-semibold">Daily logs due</h2>
    <p className="text-sm opacity-75">Your time is saved. Write your report now or later at home. Previous days must be submitted before a new clock-in.</p>
    {reports.map(report => <button key={report.logId} onClick={() => setSelected(report)} className="block w-full rounded-xl border p-3 text-left">
      <span className="block font-medium">{report.projectName}</span>
      <span className="block text-sm opacity-75">{scheduleDateLabel(report.workDate, { month: "short", day: "numeric" })} · {report.minutes} minutes recorded</span>
      <span className="block text-sm text-amber-500">{report.overdue ? "Required before clock-in" : "Write daily log"}</span>
    </button>)}
    {selected && <DailyLogComposer key={selected.logId} open onOpenChange={open => { if (!open) setSelected(null); }}
      projectId={selected.projectId} projectName={selected.projectName} report={selected} />}
  </section>;
}
