"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addScheduleInspection, createInspectionMilestone, getInspectionSchedule, linkInspectionSchedule, saveInspectionSchedule } from "@/lib/actions/inspection-schedule";
import type { InspectionHistory, InspectionMilestone, InspectionStatus, ScheduleInspection } from "@/lib/schedule/inspection-types";
import { inspectionCompletionDay } from "@/lib/schedule/inspection-completion-day";

const localDateTime = (value: string | null) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?(?:Z|\+00:00)$/.test(value)) return `${inspectionCompletionDay(value)}T00:00`;
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const formatDay = (value: string | null) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString() : "Not recorded";
const control = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const button = "rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50";

export function InspectionScheduleSection({ projectId, refreshKey }: { projectId: string; refreshKey?: string }) {
  const router = useRouter();
  const [data, setData] = useState<{ inspections: ScheduleInspection[]; milestones: InspectionMilestone[]; history: InspectionHistory[] }>({ inspections: [], milestones: [], history: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    const result = await getInspectionSchedule(projectId);
    setError(result.error ?? null);
    if (!result.error) setData(result);
    setLoading(false);
  }, [projectId]);
  useEffect(() => {
    let active = true;
    void getInspectionSchedule(projectId).then(result => {
      if (!active) return;
      setError(result.error ?? null);
      if (!result.error) setData(result);
      setLoading(false);
    });
    return () => { active = false; };
  }, [projectId, refreshKey]);
  const saved = async () => { await load(); router.refresh(); };
  const linkedIds = new Set(data.inspections.map(row => row.schedule_phase_id).filter(Boolean));

  return <section className="space-y-4 rounded-xl border bg-card p-4" data-refresh-paused={adding || !!name || undefined} aria-labelledby="inspection-schedule-heading">
    <div>
      <h3 id="inspection-schedule-heading" className="font-semibold">Inspections and schedule milestones</h3>
      <p className="mt-1 text-sm text-muted-foreground">Link each inspection to its exact milestone. Results and dates then stay together. A trade inspection does not close the project.</p>
    </div>
    {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {loading ? <p className="text-sm text-muted-foreground">Loading inspections…</p> : <>
      {data.inspections.length === 0 && <p className="text-sm text-muted-foreground">No inspections recorded. Add one below, then link its existing milestone or create one.</p>}
      {data.inspections.map(row => <InspectionEditor key={`${row.id}:${row.updated_at}`} row={row}
        milestones={data.milestones.filter(phase => !linkedIds.has(phase.id) || phase.id === row.schedule_phase_id)}
        history={data.history.filter(entry => entry.inspection_id === row.id)} onSaved={saved} />)}
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={async event => {
        event.preventDefault(); setAdding(true); setError(null);
        const result = await addScheduleInspection(projectId, name);
        if (result.error) setError(result.error); else { setName(""); await saved(); }
        setAdding(false);
      }}>
        <input aria-label="New inspection name" className={control} value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="Add an inspection, such as Final Plumbing" />
        <button type="submit" className={`${button} shrink-0`} disabled={adding || !name.trim()}>{adding ? "Adding…" : "Add inspection"}</button>
      </form>
    </>}
  </section>;
}

function InspectionEditor({ row, milestones, history, onSaved }: {
  row: ScheduleInspection; milestones: InspectionMilestone[]; history: InspectionHistory[]; onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState<InspectionStatus>(row.status);
  const [scheduledFor, setScheduledFor] = useState(row.scheduled_for ?? "");
  const [completedAt, setCompletedAt] = useState(localDateTime(row.completed_at));
  const [notes, setNotes] = useState(row.notes ?? "");
  const [phaseId, setPhaseId] = useState(row.schedule_phase_id ?? "");
  const [authority, setAuthority] = useState<"inspection" | "schedule">("inspection");
  const [newDate, setNewDate] = useState(row.scheduled_for ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPhase = milestones.find(phase => phase.id === row.schedule_phase_id);
  const selectedPhase = milestones.find(phase => phase.id === phaseId);
  const mutate = async (action: () => Promise<{ error: string | null }>) => {
    setBusy(true); setError(null);
    try { const result = await action(); if (result.error) setError(result.error); else await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save. Please try again."); }
    finally { setBusy(false); }
  };

  const hasDraft = status !== row.status || scheduledFor !== (row.scheduled_for ?? "") ||
    completedAt !== localDateTime(row.completed_at) || notes !== (row.notes ?? "") ||
    phaseId !== (row.schedule_phase_id ?? "") || authority !== "inspection" || newDate !== (row.scheduled_for ?? "");
  return <details className="rounded-lg border p-3" data-refresh-paused={busy || hasDraft || undefined} open={!row.schedule_phase_id || undefined}>
    <summary className="cursor-pointer text-sm">
      <span className="font-medium">{row.name}</span>
      <span className="ml-2 capitalize text-muted-foreground">{row.status}</span>
      <span className={`ml-2 ${row.schedule_phase_id ? "text-muted-foreground" : "font-medium text-amber-600"}`}>{row.schedule_phase_id ? `Linked · ${currentPhase?.name ?? "Milestone"}` : "Needs a milestone link"}</span>
    </summary>
    <div className="mt-4 space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        void mutate(() => saveInspectionSchedule({ id: row.id, projectId: row.project_id, expectedUpdatedAt: row.updated_at,
          status, scheduledFor: scheduledFor || null,
          completedAt: completedAt === localDateTime(row.completed_at) ? row.completed_at : completedAt ? new Date(completedAt).toISOString() : null, notes }));
      }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs">Result
            <select className={control} value={status} disabled={busy} onChange={event => setStatus(event.target.value as InspectionStatus)}>
              <option value="pending">Pending</option><option value="passed">Passed</option><option value="failed">Failed</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">Planned / booked day
            <input className={control} type="date" value={scheduledFor} disabled={busy} onChange={event => setScheduledFor(event.target.value)} />
          </label>
          <label className="space-y-1 text-xs">Actual inspection time (if known)
            <input className={control} type="datetime-local" value={completedAt} disabled={busy || status === "pending"} onChange={event => setCompletedAt(event.target.value)} />
          </label>
        </div>
        <label className="block space-y-1 text-xs">Evidence / notes
          <textarea className={control} value={notes} disabled={busy} maxLength={4000} rows={2} onChange={event => setNotes(event.target.value)} />
        </label>
        <p className="text-xs text-muted-foreground">Passed completes only the linked milestone; failed puts it on hold. Clearing a booked day makes that milestone tentative. Original planned dates remain unchanged.</p>
        <button type="submit" className={button} disabled={busy}>{busy ? "Saving…" : "Save inspection"}</button>
      </form>

      <div className="space-y-3 border-t pt-3">
        <h4 className="text-sm font-medium">Choose the exact schedule milestone</h4>
        <select aria-label={`Milestone for ${row.name}`} className={control} value={phaseId} disabled={busy} onChange={event => setPhaseId(event.target.value)}>
          <option value="">No link</option>
          {milestones.map(phase => <option key={phase.id} value={phase.id}>{phase.name} · {phase.start_date} · {phase.status.replaceAll("_", " ")} · {phase.id.slice(0, 8)}</option>)}
        </select>
        {selectedPhase && <>
          <div className="grid gap-2 rounded-md bg-muted/50 p-3 text-xs sm:grid-cols-2">
            <p>Inspection: <strong>{row.status}</strong> · planned {formatDay(row.scheduled_for)} · actual {formatDay(inspectionCompletionDay(row.completed_at))}</p>
            <p>Milestone: <strong>{selectedPhase.status.replaceAll("_", " ")}</strong> · planned {formatDay(selectedPhase.start_date)} · actual {formatDay(inspectionCompletionDay(selectedPhase.actual_completed_at))}</p>
          </div>
          <label className="block space-y-1 text-xs">Which record has the verified result and date?
            <select className={control} value={authority} disabled={busy} onChange={event => setAuthority(event.target.value as "inspection" | "schedule")}>
              <option value="inspection">Keep inspection result and booked date</option>
              <option value="schedule">Keep schedule result and date</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">Linking reconciles the two records using your choice. Historical entries are never matched by their names.</p>
        </>}
        <button type="button" className={button} disabled={busy || (!phaseId && !row.schedule_phase_id)} onClick={() => void mutate(() => linkInspectionSchedule({ id: row.id, projectId: row.project_id, phaseId: phaseId || null, authority, expectedUpdatedAt: row.updated_at, phaseExpectedUpdatedAt: selectedPhase?.updated_at ?? null }))}>{phaseId ? "Link and reconcile" : "Remove link"}</button>
        {!row.schedule_phase_id && <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="space-y-1 text-xs">If no milestone exists, choose its date
            <input className={control} type="date" value={newDate} disabled={busy} onChange={event => setNewDate(event.target.value)} />
          </label>
          <button type="button" className={button} disabled={busy || !newDate} onClick={() => void mutate(() => createInspectionMilestone({ id: row.id, projectId: row.project_id, date: newDate, expectedUpdatedAt: row.updated_at }))}>Create linked milestone</button>
        </div>}
      </div>
      {history.length > 0 && <details className="border-t pt-3">
        <summary className="cursor-pointer text-xs font-medium">Change history ({history.length})</summary>
        <ul className="mt-2 space-y-2 text-xs text-muted-foreground">{history.slice(0, 12).map(entry => <li key={entry.id}>
          {new Date(entry.created_at).toLocaleString()} · {entry.source} · {entry.before_record?.status ?? "new"} → {entry.after_record?.status ?? "removed"}
          {entry.before_record?.schedule_phase_id !== entry.after_record?.schedule_phase_id && " · milestone link changed"}
          {entry.before_record?.scheduled_for !== entry.after_record?.scheduled_for && ` · planned day ${formatDay(entry.after_record?.scheduled_for ?? null)}`}
        </li>)}</ul>
      </details>}
    </div>
  </details>;
}
