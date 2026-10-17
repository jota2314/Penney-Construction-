"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getScheduleReview, reconcileProjectSchedule, reviewFieldProgress, verifyClientPhaseCompletion } from "@/lib/actions/schedule-review";
import { scheduleProgress } from "@/lib/schedule/progress";

type ReviewData = NonNullable<Awaited<ReturnType<typeof getScheduleReview>>["data"]>;
type Report = ReviewData["reports"][number];
const control = "w-full rounded border bg-background p-2 text-sm";

export function ScheduleReconciliation({ projectId, refreshKey }: { projectId: string; refreshKey?: string }) {
  const router = useRouter();
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const latestLoad = useRef(0);
  const [busy, start] = useTransition();
  const load = useCallback(async () => {
    const request = ++latestLoad.current;
    const result = await getScheduleReview(projectId, page);
    if (request !== latestLoad.current) return;
    setData(result.data); setError(result.error);
  }, [projectId, page]);
  useEffect(() => {
    const request = ++latestLoad.current;
    const lifecycle = { cancelled: false };
    void getScheduleReview(projectId, page).then((result) => {
      if (lifecycle.cancelled || request !== latestLoad.current) return;
      setData(result.data); setError(result.error);
    });
    return () => { lifecycle.cancelled = true; };
  }, [projectId, page, refreshKey]);
  const refresh = async () => { await load(); router.refresh(); };
  if (!data) return <div className="mb-4 text-sm text-muted-foreground" role="status">{error ?? "Loading schedule review…"}</div>;
  const progress = scheduleProgress(data.phases);
  const clientReports = data.phases.filter(phase => phase.client_completed_at && phase.status !== "completed");
  const pending = data.reports.filter(report => !report.review);
  const needsStart = ["lead", "estimating", "waiting_for_approval", "proposal_sent", "contracted"].includes(data.project.status);
  const transition = (status: "in_progress" | "completed") => start(async () => {
    const result = await reconcileProjectSchedule(projectId, data.project.status, status);
    setError(result.error); if (!result.error) await refresh();
  });
  return (
    <details className="mb-4 rounded-lg border p-4" data-refresh-paused={busy || undefined} open={progress.readyToClose && data.project.status !== "completed"}>
      <summary className="cursor-pointer font-semibold">Schedule review · {pending.length} field report{pending.length === 1 ? "" : "s"} on this page{clientReports.length > 0 ? ` · ${clientReports.length} client completion reports` : ""}</summary>
      <p className="my-3 text-sm text-muted-foreground">Verified progress: {progress.completed} of {progress.total} master phases ({progress.percent}%). Review field evidence before changing the master schedule.</p>
      {error && <p className="my-2 text-sm text-destructive" role="alert">{error}</p>}
      {progress.total === 0 && <p className="my-2 text-sm text-amber-600">This project needs a master schedule. Daily crew assignments do not supply one. Build it below, then link the reports to its phases.</p>}
      {needsStart && <div className="my-3 flex flex-wrap items-center gap-3 text-sm"><span>Project still shows {data.project.status.replaceAll("_", " ")}. If work has started, confirm it here.</span><Button size="sm" disabled={busy} onClick={() => transition("in_progress")}>Confirm work started</Button></div>}
      {progress.readyToClose && data.project.status !== "completed" && <div className="my-3 flex flex-wrap items-center gap-3 text-sm"><span>All master phases are verified complete. Confirm physical completion after all inspections pass.</span><Button size="sm" disabled={busy} onClick={() => transition("completed")}>Confirm project complete</Button></div>}
      {data.project.status === "completed" && progress.total > progress.completed && <div className="my-3 flex flex-wrap items-center gap-3 text-sm"><span>Project is complete but master work is still open. Verify those phases or reopen the project.</span><Button size="sm" disabled={busy} onClick={() => transition("in_progress")}>Reopen for remaining work</Button></div>}
      {clientReports.map(phase => <ClientCompletionReview key={`${phase.id}:${phase.updated_at}`} projectId={projectId} phase={phase} onSaved={refresh} />)}
      <div className="space-y-3">{data.reports.map(report => <FieldReportReview key={`${report.id}:${report.updated_at}`} projectId={projectId} report={report} phases={data.phases} onSaved={refresh} />)}</div>
      {!data.reports.length && <p className="text-sm text-muted-foreground">No written field reports on this page.</p>}
      <div className="mt-3 flex items-center gap-3"><Button size="sm" variant="outline" disabled={page === 0 || busy} onClick={() => setPage(page - 1)}>Newer reports</Button><span className="text-sm">Page {page + 1}</span><Button size="sm" variant="outline" disabled={!data.hasMore || busy} onClick={() => setPage(page + 1)}>Older reports</Button></div>
    </details>
  );
}

function ClientCompletionReview({ projectId, phase, onSaved }: { projectId: string; phase: ReviewData["phases"][number]; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return <div className="my-2 space-y-2 rounded border p-3 text-sm" data-refresh-paused={busy || !!note || undefined}>
    <p>Client reports complete: <b>{phase.name}</b></p>
    {phase.event_type === "inspection" ? <p className="text-muted-foreground">Verify the inspection result in Inspections.</p> : <>
      <label className="block">Verification note<textarea aria-label={`Verification note for ${phase.name}`} className={control} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="What you checked before verifying this phase complete" /></label>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => start(async () => {
        const result = await verifyClientPhaseCompletion({ projectId, phaseId: phase.id, phaseUpdatedAt: phase.updated_at, clientCompletedAt: phase.client_completed_at!, note });
        setError(result.error); if (!result.error) await onSaved();
      })}>{busy ? "Verifying…" : "Verify phase complete"}</Button>
    </>}
  </div>;
}

function FieldReportReview({ projectId, report, phases, onSaved }: { projectId: string; report: Report; phases: ReviewData["phases"]; onSaved: () => Promise<void> }) {
  const [phaseId, setPhaseId] = useState(report.master_phase_id ?? "");
  const [phaseVersion, setPhaseVersion] = useState(phases.find(row => row.id === report.master_phase_id)?.updated_at ?? null);
  const [status, setStatus] = useState<"" | "in_progress" | "completed" | "on_hold">("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const phase = phases.find(row => row.id === phaseId);
  const hasDraft = !!note || !!status || !!endDate || phaseId !== (report.master_phase_id ?? "");
  return <details className="rounded border p-3" data-refresh-paused={!report.review && (busy || hasDraft) || undefined}>
    <summary className="cursor-pointer text-sm font-medium">{new Date(report.started_at).toLocaleDateString("en-US", { timeZone: "America/New_York" })} · {report.review ? "Reviewed" : "Needs review"} · {(report.text ?? "Field report").slice(0, 100)}</summary>
    <p className="my-3 whitespace-pre-wrap text-sm">{report.text}</p>
    {report.review ? <p className="text-sm text-muted-foreground">Review: {report.review.note}</p> : <div className="space-y-3">
      <label className="block text-sm">Master phase<select aria-label="Master phase" className={control} value={phaseId} onChange={event => { setPhaseId(event.target.value); setPhaseVersion(phases.find(row => row.id === event.target.value)?.updated_at ?? null); setStatus(""); setEndDate(""); }}><option value="">No phase change — review only</option>{phases.map(row => <option key={row.id} value={row.id}>{row.name} ({row.status.replaceAll("_", " ")})</option>)}</select></label>
      {phase && phase.event_type !== "inspection" && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Verified status<select aria-label="Verified status" className={control} value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="">Keep current status</option><option value="in_progress">Work started</option><option value="completed">Phase complete</option><option value="on_hold">Blocked / on hold</option></select></label><label className="text-sm">Revised finish (optional)<input aria-label="Revised finish" type="date" min={phase.start_date} className={control} value={endDate} onChange={event => setEndDate(event.target.value)} /></label></div>}
      {phase?.event_type === "inspection" && <p className="text-sm text-muted-foreground">Link this evidence here; record the inspection result in Inspections.</p>}
      <label className="block text-sm">Verification / remaining work<textarea aria-label="Verification note" className={control} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="What you verified, what remains, and any blockers or time needed" /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button size="sm" disabled={busy || !note.trim()} onClick={() => start(async () => {
        const result = await reviewFieldProgress({ projectId, logId: report.id, phaseId: phase?.id ?? null, evidenceUpdatedAt: report.updated_at, phaseUpdatedAt: phaseVersion, status: status || null, endDate: endDate || null, note });
        setError(result.error); if (!result.error) await onSaved();
      })}>{busy ? "Saving…" : "Save verified update"}</Button>
    </div>}
  </details>;
}
