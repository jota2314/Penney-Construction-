"use client";

import { useState } from "react";
import { CalendarDays, CalendarPlus, Check, X } from "lucide-react";
import type { Phase, Project, ScheduleAction } from "./types";
import { Card, DirectionsLink, EmptyState, MONO, Notice, Pill, SectionLabel, btnGhost, btnPrimary, fmtDate, inputCls } from "./ui";

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Schedule, both ways. The office puts him on a phase → he taps Confirm or
 * Can't make it. He puts his own dates on → the office is told. Bucketed the
 * way a sub thinks about a week: this week, next week, later.
 */
export function ScheduleTab({
  upcoming,
  past,
  projectById,
  liveJobs,
  busy,
  notice,
  onAction,
}: {
  upcoming: Phase[];
  past: Phase[];
  projectById: Map<string, Project>;
  liveJobs: Project[];
  busy: string | null;
  notice: { kind: "ok" | "err"; text: string } | null;
  onAction: (a: ScheduleAction) => void;
}) {
  const [adding, setAdding] = useState(false);
  const now = new Date();
  const nextWeekStart = iso(new Date(startOfWeek(now).getTime() + 7 * 86_400_000));
  const weekAfterStart = iso(new Date(startOfWeek(now).getTime() + 14 * 86_400_000));

  const bucket = (p: Phase) => {
    const s = p.start_date ?? "";
    if (!s) return "later";
    if (s < nextWeekStart) return "this";
    if (s < weekAfterStart) return "next";
    return "later";
  };
  const needsAnswer = upcoming.filter((p) => p.is_confirmed && !p.sub_response && !p.mine);
  const groups: [string, Phase[]][] = [
    ["This week", upcoming.filter((p) => bucket(p) === "this")],
    ["Next week", upcoming.filter((p) => bucket(p) === "next")],
    ["Later", upcoming.filter((p) => bucket(p) === "later")],
  ];

  return (
    <div className="space-y-6">
      {notice && <Notice kind={notice.kind} text={notice.text} />}

      {/* add my own dates */}
      {liveJobs.length > 0 &&
        (adding ? (
          <AddDatesForm
            jobs={liveJobs}
            busy={busy === "propose"}
            onCancel={() => setAdding(false)}
            onSubmit={(a) => {
              onAction(a);
              setAdding(false);
            }}
          />
        ) : (
          <button onClick={() => setAdding(true)} className={`${btnPrimary} w-full py-3.5 text-[13px]`}>
            <CalendarPlus className="h-5 w-5" />
            Add my dates
          </button>
        ))}

      {needsAnswer.length > 0 && (
        <p className="text-[12px] text-amber-300">
          {needsAnswer.length} date{needsAnswer.length === 1 ? "" : "s"} waiting on your answer.
        </p>
      )}

      {upcoming.length === 0 && past.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="Nothing on the schedule"
          body="Add your own dates above, or we'll add you when your next phase is booked."
        />
      )}

      {groups.map(([label, phases]) =>
        phases.length === 0 ? null : (
          <section key={label}>
            <SectionLabel right={<span className="text-[11px] text-stone-600" style={MONO}>{phases.length}</span>}>
              {label}
            </SectionLabel>
            <div className="space-y-2.5">
              {phases.map((p) => (
                <PhaseCard key={p.id} p={p} proj={projectById.get(p.project_id)} today={iso(now)} busy={busy} onAction={onAction} />
              ))}
            </div>
          </section>
        ),
      )}

      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] uppercase tracking-[0.24em] text-stone-500" style={MONO}>
            Past work ({past.length})
          </summary>
          <div className="mt-3 space-y-2">
            {[...past].reverse().map((p) => {
              const proj = projectById.get(p.project_id);
              return (
                <div key={p.id} className="rounded-xl border border-white/[0.05] px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13px] text-stone-400">{p.name}</p>
                    <p className="shrink-0 text-[11px] text-stone-600" style={MONO}>{fmtDate(p.start_date)}</p>
                  </div>
                  {proj && <p className="text-[11px] text-stone-600" style={MONO}>{proj.name}</p>}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

/** One phase: dates, job, and the answer buttons when the office is waiting on him. */
export function PhaseCard({
  p,
  proj,
  today,
  busy,
  onAction,
  compact = false,
}: {
  p: Phase;
  proj: Project | undefined;
  today: string;
  busy: string | null;
  onAction: (a: ScheduleAction) => void;
  compact?: boolean;
}) {
  const [declining, setDeclining] = useState(false);
  const [why, setWhy] = useState("");
  const active = !!p.start_date && p.start_date <= today && (!p.end_date || p.end_date >= today);
  const pending = p.is_confirmed && !p.sub_response && !p.mine;
  const isBusy = busy === `phase:${p.id}`;

  const pill = p.mine ? (
    <Pill tone="amber">You added this</Pill>
  ) : !p.is_confirmed ? (
    <Pill tone="muted">Tentative</Pill>
  ) : p.sub_response === "confirmed" ? (
    <Pill tone="emerald">Confirmed</Pill>
  ) : p.sub_response === "declined" ? (
    <Pill tone="red">Can&apos;t make it</Pill>
  ) : (
    <Pill tone="amber">Needs your answer</Pill>
  );

  return (
    <Card tone={pending ? "amber" : active ? "emerald" : "default"} className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-stone-100">{p.name}</p>
          <p className="mt-0.5 text-[12px] text-amber-400" style={MONO}>
            {fmtDate(p.start_date)}
            {p.end_date && p.end_date !== p.start_date ? ` – ${fmtDate(p.end_date)}` : ""}
          </p>
        </div>
        {pill}
      </div>
      {proj && (
        <p className="mt-1 text-[12px] text-stone-500" style={MONO}>
          {proj.name}
          {proj.address ? ` · ${proj.address}` : ""}
        </p>
      )}
      {!compact && p.description && <p className="mt-2 text-[13px] leading-relaxed text-stone-400">{p.description}</p>}
      {!compact && p.notes && <p className="mt-1 whitespace-pre-line text-[12px] text-stone-500">{p.notes}</p>}

      {pending && !declining && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button disabled={isBusy} onClick={() => onAction({ action: "confirm", phaseId: p.id })} className={`${btnPrimary} py-2.5`}>
            <Check className="h-4 w-4" />
            {isBusy ? "…" : "Confirm"}
          </button>
          <button disabled={isBusy} onClick={() => setDeclining(true)} className={`${btnGhost} py-2.5`}>
            <X className="h-4 w-4" />
            Can&apos;t make it
          </button>
        </div>
      )}
      {pending && declining && (
        <div className="mt-3 space-y-2">
          <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} placeholder="When can you? (optional)" className={inputCls} />
          <div className="flex items-center gap-2">
            <button
              disabled={isBusy}
              onClick={() => {
                onAction({ action: "decline", phaseId: p.id, note: why.trim() || undefined });
                setDeclining(false);
                setWhy("");
              }}
              className={`${btnPrimary} flex-1 py-2.5`}
            >
              Send
            </button>
            <button onClick={() => setDeclining(false)} className="text-[11px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>
              Back
            </button>
          </div>
        </div>
      )}

      {!compact && p.sub_response && !p.mine && (
        <button
          disabled={isBusy}
          onClick={() => onAction({ action: p.sub_response === "confirmed" ? "decline" : "confirm", phaseId: p.id })}
          className="mt-2.5 text-[11px] uppercase tracking-[0.14em] text-stone-500 underline underline-offset-2 disabled:opacity-40"
          style={MONO}
        >
          {p.sub_response === "confirmed" ? "Changed your mind? Can't make it" : "Changed your mind? Confirm"}
        </button>
      )}
      {!compact && p.mine && (
        <button
          disabled={isBusy}
          onClick={() => onAction({ action: "cancel", phaseId: p.id })}
          className="mt-2.5 text-[11px] uppercase tracking-[0.14em] text-stone-500 underline underline-offset-2 disabled:opacity-40"
          style={MONO}
        >
          {isBusy ? "…" : "Take these dates off"}
        </button>
      )}
      {!compact && proj?.address && (
        <div className="mt-2.5">
          <DirectionsLink address={proj.address} />
        </div>
      )}
    </Card>
  );
}

/** Job, dates, what, how many guys. That's it. */
function AddDatesForm({
  jobs,
  busy,
  onCancel,
  onSubmit,
}: {
  jobs: Project[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (a: ScheduleAction) => void;
}) {
  const [job, setJob] = useState(jobs[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [what, setWhat] = useState("");
  const [crew, setCrew] = useState("");
  const [note, setNote] = useState("");
  const ok = job && start && what.trim() && (!end || end >= start);

  return (
    <Card tone="amber" className="p-4">
      <SectionLabel>Add my dates</SectionLabel>
      <div className="space-y-3">
        <select value={job} onChange={(e) => setJob(e.target.value)} className={inputCls}>
          {jobs.map((j) => (
            <option key={j.id} value={j.id} className="bg-stone-900">
              {j.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-stone-500" style={MONO}>
              From
            </p>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-stone-500" style={MONO}>
              To (optional)
            </p>
            <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </div>
        </div>
        <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What you'll be doing (e.g. Rough plumbing)" className={inputCls} />
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <input type="number" inputMode="numeric" min={1} max={50} value={crew} onChange={(e) => setCrew(e.target.value)} placeholder="Guys" className={inputCls} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={inputCls} />
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={busy || !ok}
            onClick={() =>
              onSubmit({
                action: "propose",
                projectId: job,
                startDate: start,
                endDate: end || start,
                name: what.trim(),
                crew: crew ? Number(crew) : undefined,
                note: note.trim() || undefined,
              })
            }
            className={`${btnPrimary} flex-1 py-3`}
          >
            {busy ? "Sending…" : "Send to Penney"}
          </button>
          <button onClick={onCancel} className={`${btnGhost} px-4 py-3`}>
            Cancel
          </button>
        </div>
        <p className="text-[11px] text-stone-600">Jorge, Ryan, and the job&apos;s PM get a notification the moment you send it.</p>
      </div>
    </Card>
  );
}
