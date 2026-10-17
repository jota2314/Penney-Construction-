"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Empty,
  PortalNotice,
  PortalSheet,
  TIMELINE_CHIP,
  TimelineList,
  TimelineRow,
  usePortalAction,
  type PortalAction,
  type TimelineChip,
} from "@/components/portal-kit";
import { telHref } from "@/lib/portal-kit/format";
import { coversDay } from "@/lib/sub-portal/et-day";
import type { DayString, SubDateBucket, SubDatePhase, SubDatesPayload, SubScheduleAction } from "@/lib/sub-portal/payload";

/**
 * Dates: his phases on a timeline, the only place he answers them.
 *
 * Two-way scheduling, as the office runs it: Penney books him and he taps
 * Confirm or Can't make it (with an optional "when can you?" note); he can
 * also put his own dates on a job ("Add my dates") and take those back off.
 * The buttons show only on a confirmed phase still waiting for his answer
 * (needs_answer). Penciled-in phases are read-only: "Week of …" and
 * "Penciled in · Penney will confirm". Past work is folded at the bottom.
 *
 * Everything posts to the existing /api/sub-portal/schedule route, which
 * tells Jorge, Ryan and the job's PM.
 */

const ENDPOINT = "/api/sub-portal/schedule";

const BUCKETS: { key: Exclude<SubDateBucket, "past">; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "next_week", label: "Next week" },
  { key: "later", label: "Later" },
  { key: "unscheduled", label: "Date to be set" },
];

const INPUT =
  "block min-h-[52px] w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 text-[16px] text-[var(--ink)]";
// iOS draws date boxes wider than their column and centres the value; this keeps them in the grid.
const DATE_INPUT = `${INPUT} min-w-0 appearance-none text-left [&::-webkit-date-and-time-value]:text-left`;

export function DatesTab({
  dates,
  today,
  preview,
  officePhone,
  onReload,
  focusPhaseId,
  onFocused,
}: {
  dates: SubDatesPayload;
  /** The server's ET day. */
  today: DayString;
  preview: boolean;
  officePhone: string;
  onReload: () => void;
  /** Scroll this phase into view once (from a Needed "Answer" row). */
  focusPhaseId: string | null;
  onFocused: () => void;
}) {
  const rowAction = usePortalAction(ENDPOINT, !preview);
  const sheetAction = usePortalAction(ENDPOINT, !preview);
  // Where the row action's message shows: under that phase, or at the top
  // when the phase goes away (dates he took off).
  const [noticeAt, setNoticeAt] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!focusPhaseId) return;
    document.getElementById(`phase-${focusPhaseId}`)?.scrollIntoView({ block: "center" });
    onFocused();
  }, [focusPhaseId, onFocused]);

  const byBucket = new Map<SubDateBucket, SubDatePhase[]>();
  for (const p of dates.phases) {
    const list = byBucket.get(p.bucket);
    if (list) list.push(p);
    else byBucket.set(p.bucket, [p]);
  }
  // Newest past work first.
  const past = [...(byBucket.get("past") ?? [])].reverse();

  const send = (at: string, key: string, body: SubScheduleAction, success: string) => {
    setNoticeAt(at);
    void rowAction.run(key, body, { success, onSuccess: () => onReload() });
  };

  const rowProps = (p: SubDatePhase) => ({
    p,
    today,
    action: rowAction,
    showNotice: noticeAt === p.id,
    onConfirm: () =>
      send(p.id, `confirm:${p.id}`, { action: "confirm", phaseId: p.id }, "Confirmed. Penney knows you'll be there."),
    onDecline: (note: string) =>
      send(
        p.id,
        `decline:${p.id}`,
        { action: "decline", phaseId: p.id, note: note || undefined },
        "Sent. Penney will work out another day with you.",
      ),
    onCancel: () => send("top", `cancel:${p.id}`, { action: "cancel", phaseId: p.id }, "Taken off. Penney has been told."),
  });

  return (
    <>
      {noticeAt === "top" && <PortalNotice notice={rowAction.notice} onDismiss={rowAction.clearNotice} />}
      {!adding && <PortalNotice notice={sheetAction.notice} onDismiss={sheetAction.clearNotice} />}

      {dates.can_propose_on.length > 0 && (
        <button
          type="button"
          onClick={() => {
            sheetAction.clearNotice();
            setAdding(true);
          }}
          className="btn btn-ghost btn-lg btn-block"
        >
          + Add my dates
        </button>
      )}

      {dates.answers_needed > 0 && (
        <p className="px-1 text-[16px] font-bold text-[var(--accent-dark)]">
          {dates.answers_needed} {dates.answers_needed === 1 ? "date is" : "dates are"} waiting on your answer.
        </p>
      )}

      {dates.phases.length === 0 && (
        <Empty>Nothing on your schedule yet. Add your own dates, or Penney adds you when your next work is booked.</Empty>
      )}

      {BUCKETS.map(({ key, label }) => {
        const list = byBucket.get(key) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={key}>
            <p className="label mb-2 px-1">{label}</p>
            <TimelineList>
              {list.map((p) => (
                <PhaseRow key={p.id} {...rowProps(p)} />
              ))}
            </TimelineList>
          </section>
        );
      })}

      {past.length > 0 && (
        <details className="group">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center px-1 text-[16px] font-bold text-[var(--muted)] [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="mr-2 inline-block group-open:rotate-90">
              ›
            </span>
            Past work ({past.length})
          </summary>
          <div className="mt-2">
            <TimelineList>
              {past.map((p) => (
                <PhaseRow key={p.id} {...rowProps(p)} />
              ))}
            </TimelineList>
          </div>
        </details>
      )}

      {dates.phases.some((p) => p.sub_response && !p.mine && p.bucket !== "past") && (
        <p className="px-1 text-center text-[15px] text-[var(--muted)]">
          Plans changed after you answered?{" "}
          <a href={telHref(officePhone)} className="font-bold text-[var(--accent-dark)] underline">
            Call the office
          </a>
        </p>
      )}

      {adding && (
        <AddDatesSheet
          jobs={dates.can_propose_on}
          preview={preview}
          action={sheetAction}
          onClose={() => setAdding(false)}
          onSent={() => {
            setAdding(false);
            onReload();
          }}
        />
      )}
    </>
  );
}

/** The chip on a phase: what state it's in, from his side. */
function chipFor(p: SubDatePhase, now: boolean): TimelineChip {
  if (p.status === "completed") return "done";
  if (p.needs_answer) return "answer";
  if (p.sub_response === "declined" && !p.mine) return "declined";
  if (!p.firm) return "penciled";
  if (now) return "now";
  if (p.mine) return { label: "Your dates", color: TIMELINE_CHIP.confirmed.color };
  return "confirmed";
}

/** One phase on the timeline, with Confirm / Can't make it only when Penney is waiting on him. */
function PhaseRow({
  p,
  today,
  action,
  showNotice,
  onConfirm,
  onDecline,
  onCancel,
}: {
  p: SubDatePhase;
  today: DayString;
  action: PortalAction;
  showNotice: boolean;
  onConfirm: () => void;
  onDecline: (note: string) => void;
  onCancel: () => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [why, setWhy] = useState("");
  const [askCancel, setAskCancel] = useState(false);

  const done = p.status === "completed";
  const now = !done && p.bucket !== "past" && (p.status === "in_progress" || coversDay(p.start_date, p.end_date, today));
  const canAnswer = p.needs_answer && !done;
  const canCancel = p.mine && !done && p.bucket !== "past";
  const off = !action.enabled || action.busy;

  let actions: ReactNode = undefined;
  if (canAnswer && !declining) {
    actions = (
      <>
        <button type="button" onClick={onConfirm} disabled={off} className="btn btn-primary">
          {action.isBusy(`confirm:${p.id}`) ? "Saving…" : "✓ Confirm"}
        </button>
        <button type="button" onClick={() => setDeclining(true)} disabled={off} className="btn btn-ghost">
          Can&apos;t make it
        </button>
      </>
    );
  } else if (canAnswer && declining) {
    actions = (
      <>
        <label className="basis-full">
          <span className="label">When can you? (optional)</span>
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Thursday works, or next week"
            className={`${INPUT} mt-1`}
          />
        </label>
        <button
          type="button"
          onClick={() => onDecline(why.trim())}
          disabled={off}
          className="btn btn-primary"
        >
          {action.isBusy(`decline:${p.id}`) ? "Sending…" : "Send"}
        </button>
        <button type="button" onClick={() => setDeclining(false)} disabled={action.busy} className="btn btn-ghost">
          Back
        </button>
      </>
    );
  } else if (canCancel && !askCancel) {
    actions = (
      <button type="button" onClick={() => setAskCancel(true)} disabled={off} className="btn btn-ghost">
        Take these dates off
      </button>
    );
  } else if (canCancel && askCancel) {
    actions = (
      <>
        <p className="basis-full text-[16px] font-bold">Take these dates off the calendar?</p>
        <button type="button" onClick={onCancel} disabled={off} className="btn btn-primary">
          {action.isBusy(`cancel:${p.id}`) ? "Saving…" : "Yes, take them off"}
        </button>
        <button type="button" onClick={() => setAskCancel(false)} disabled={action.busy} className="btn btn-ghost">
          Keep them
        </button>
      </>
    );
  }

  const answer = p.mine
    ? "You added these dates"
    : p.sub_response === "confirmed"
      ? "✓ You said you'll be there"
      : p.sub_response === "declined"
        ? "You said you can't make it"
        : null;

  return (
    <TimelineRow
      name={p.name}
      description={p.project_name}
      shape={p.event_type === "inspection" ? "diamond" : "dot"}
      chip={chipFor(p, now)}
      filled={done || now}
      highlight={now}
      muted={p.bucket === "past"}
      start={p.start_date}
      end={p.end_date}
      firm={p.firm}
      actions={actions}
    >
      {/* Anchor for "Answer" on Today, which scrolls here. */}
      <span id={`phase-${p.id}`} />
      {!p.firm && !done && <p className="mt-1 text-[15px] font-semibold">Penciled in · Penney will confirm</p>}
      {p.description && <p className="clamp3 mt-1 text-[15px] text-[var(--muted)]">{p.description}</p>}
      {answer && (
        <p className="mt-1 text-[15px] font-semibold">
          {answer}
          {p.sub_response_note ? `: ${p.sub_response_note}` : ""}
        </p>
      )}
      {showNotice && <PortalNotice notice={action.notice} onDismiss={action.clearNotice} className="mt-3" />}
    </TimelineRow>
  );
}

/** Job, dates, what he'll be doing, an optional note. That's it. */
function AddDatesSheet({
  jobs,
  preview,
  action,
  onClose,
  onSent,
}: {
  jobs: { project_id: string; name: string }[];
  preview: boolean;
  action: PortalAction;
  onClose: () => void;
  onSent: () => void;
}) {
  // No preselected job when he has more than one: dates on the wrong job
  // show on the wrong homeowner's schedule.
  const [projectId, setProjectId] = useState(jobs.length === 1 ? jobs[0].project_id : "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [what, setWhat] = useState("");
  const [note, setNote] = useState("");

  const endBefore = !!start && !!end && end < start;
  const ready = !!projectId && !!start && !!what.trim() && !endBefore;

  const submit = () => {
    if (!ready) return;
    const body: SubScheduleAction = {
      action: "propose",
      projectId,
      startDate: start,
      endDate: end || start,
      name: what.trim(),
      note: note.trim() || undefined,
    };
    void action.run("propose", body, {
      success: "Your dates are on the calendar. Penney has been told.",
      onSuccess: () => onSent(),
    });
  };

  return (
    <PortalSheet
      title="Add my dates"
      onClose={onClose}
      locked={action.busy}
      footer={
        <button
          type="button"
          onClick={submit}
          disabled={!ready || !action.enabled || action.busy}
          className="btn btn-primary btn-lg btn-block"
        >
          {action.busy ? "Sending…" : "Send to Penney"}
        </button>
      }
    >
      <div className="space-y-4">
        {preview && <p className="text-[15px] font-semibold text-[var(--muted)]">This is a preview. Nothing you tap here is saved.</p>}
        <label className="block">
          <span className="label">Job</span>
          {jobs.length === 1 ? (
            <span className="mt-1 block text-[17px] font-bold">{jobs[0].name}</span>
          ) : (
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${INPUT} mt-1`}>
              <option value="" disabled>
                Pick a job
              </option>
              {jobs.map((j) => (
                <option key={j.project_id} value={j.project_id}>
                  {j.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0">
            <span className="label">From</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${DATE_INPUT} mt-1`} />
          </label>
          <label className="block min-w-0">
            <span className="label">To (optional)</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className={`${DATE_INPUT} mt-1`}
            />
          </label>
        </div>
        {endBefore && <p className="text-[15px] font-semibold text-[#8A2D10]">The end date has to be on or after the start.</p>}
        <label className="block">
          <span className="label">What you&apos;ll be doing</span>
          <input
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            maxLength={120}
            placeholder="Tile, demo, rough plumbing…"
            className={`${INPUT} mt-1`}
          />
          <span className="mt-1 block text-[14px] text-[var(--muted)]">
            The homeowner&apos;s schedule shows only your trade for those days. What you type here and in Note goes to
            Penney.
          </span>
        </label>
        <label className="block">
          <span className="label">Note to Penney (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={`${INPUT} mt-1`} />
        </label>
        <p className="text-[15px] text-[var(--muted)]">Jorge, Ryan and the job&apos;s PM are told when you send it.</p>
        <PortalNotice notice={action.notice} onDismiss={action.clearNotice} />
      </div>
    </PortalSheet>
  );
}
