"use client";

import { Empty } from "@/components/portal-kit";
import { fmtTime } from "@/lib/portal-kit/format";
import type { SubHomePayload, SubJobRow, SubNeededItem, SubVisitSummary } from "@/lib/sub-portal/payload";
import type { OpenJobOptions } from "./sub-portal-view";

/**
 * Today: a plain list he taps, nothing picked for him.
 *  1. Here now, only when he scanned the sign at a job today (a post or
 *     clock-in alone never says he's here).
 *  2. Needed from you: one 60px row and one button each.
 *  3. Your jobs: Today / This week / Other open jobs, in the order the
 *     server sorted them. A tap opens that job's screen.
 *
 * No GPS, no "your job today is probably…" fallback, and no date buttons
 * here: dates are answered only on the Dates tab, so a phase can't be
 * confirmed from two places.
 */
export function TodayTab({
  data,
  needed,
  preview,
  canFixBill,
  onOpenJob,
  onAnswerDates,
  onSign,
  onFixBill,
}: {
  data: SubHomePayload;
  /** data.needed, less rows for features that are switched off. */
  needed: SubNeededItem[];
  preview: boolean;
  /** "Fix & resend" opens the invoice sheet (bills on, not a preview). */
  canFixBill: boolean;
  onOpenJob: (projectId: string, opts?: OpenJobOptions) => void;
  onAnswerDates: (phaseId: string) => void;
  onSign: (agreementId: string) => void;
  onFixBill: (projectId: string | null) => void;
}) {
  const here =
    data.here_now && data.here_now.visit_date === data.today && data.here_now.scans > 0 ? data.here_now : null;
  const { today, this_week, other } = data.jobs;
  const noJobs = today.length + this_week.length + other.length === 0;

  return (
    <>
      {here && (
        <HereNowCard
          visit={here}
          clockedInSince={data.clock?.project_id === here.project_id ? data.clock.started_at : null}
          onAddPhotos={() => onOpenJob(here.project_id, { compose: true })}
        />
      )}

      {needed.length > 0 && (
        <section className="card px-4 pb-1 pt-4">
          <p className="label">Needed from you ({needed.length})</p>
          <ul className="mt-1 divide-y divide-[var(--line)]">
            {needed.map((n) => (
              <NeededRow
                key={n.key}
                item={n}
                preview={preview}
                canFixBill={canFixBill}
                onOpenJob={onOpenJob}
                onAnswerDates={onAnswerDates}
                onSign={onSign}
                onFixBill={onFixBill}
              />
            ))}
          </ul>
        </section>
      )}

      {noJobs ? (
        <Empty>No open jobs right now. When Penney books you on a job, it shows up here.</Empty>
      ) : (
        <>
          <h2 className="px-1 pt-2 text-[19px] font-extrabold">Your jobs</h2>
          <JobSection label="Today" rows={today} onOpenJob={onOpenJob} />
          <JobSection label="This week" rows={this_week} onOpenJob={onOpenJob} />
          <JobSection label="Other open jobs" rows={other} onOpenJob={onOpenJob} />
        </>
      )}
    </>
  );
}

/** "At Pedersen since 7:12 AM", what he's posted there today, and one big button to add photos. */
function HereNowCard({
  visit,
  clockedInSince,
  onAddPhotos,
}: {
  visit: SubVisitSummary;
  clockedInSince: string | null;
  onAddPhotos: () => void;
}) {
  const posts = `${visit.posts} ${visit.posts === 1 ? "post" : "posts"}`;
  const photos = visit.photos > 0 ? ` · ${visit.photos} ${visit.photos === 1 ? "photo" : "photos"}` : "";
  return (
    // The 4px accent edge is inline: the kit's .card border would beat a Tailwind border-l class.
    <section className="card p-4" style={{ borderLeft: "4px solid var(--accent)" }}>
      <p className="label">Here now</p>
      <p className="mt-1 text-[19px] font-extrabold leading-snug">
        At {visit.project_name} since {fmtTime(visit.first_seen_at)}
      </p>
      <p className="mt-0.5 text-[15px] text-[var(--muted)]">
        {posts}
        {photos}
        {clockedInSince ? ` · on the clock since ${fmtTime(clockedInSince)}` : ""}
      </p>
      <button type="button" onClick={onAddPhotos} className="btn btn-primary btn-lg btn-block mt-4">
        Add today&apos;s photos
      </button>
    </section>
  );
}

/** One thing Penney is waiting on, with the one button that does it. */
function NeededRow({
  item,
  preview,
  canFixBill,
  onOpenJob,
  onAnswerDates,
  onSign,
  onFixBill,
}: {
  item: SubNeededItem;
  preview: boolean;
  canFixBill: boolean;
  onOpenJob: (projectId: string, opts?: OpenJobOptions) => void;
  onAnswerDates: (phaseId: string) => void;
  onSign: (agreementId: string) => void;
  onFixBill: (projectId: string | null) => void;
}) {
  let onTap: (() => void) | null = null;
  let detail = item.detail;
  switch (item.kind) {
    case "answer_dates":
      onTap = () => onAnswerDates(item.phase_id);
      break;
    case "sign_agreement":
      // The sign sheet opens in preview too; it shows the agreement read-only.
      onTap = () => onSign(item.agreement_id);
      break;
    case "bill_returned":
      detail = detail ?? (item.reason ? `Sent back: ${item.reason}` : null);
      onTap = canFixBill ? () => onFixBill(item.project_id) : null;
      break;
    case "add_photos": {
      const projectId = item.project_id;
      onTap = projectId ? () => onOpenJob(projectId, { compose: true }) : null;
      break;
    }
  }
  return (
    <li className="flex min-h-[60px] items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-bold leading-snug">{item.title}</p>
        {detail && <p className="clamp3 mt-0.5 text-[15px] text-[var(--muted)]">{detail}</p>}
      </div>
      <button
        type="button"
        onClick={onTap ?? undefined}
        disabled={!onTap}
        title={!onTap && preview ? "Not available in the preview" : undefined}
        className="btn btn-primary shrink-0"
      >
        {item.action_label}
      </button>
    </li>
  );
}

/** A labelled card of 60px job rows; nothing at all when the section is empty. */
function JobSection({
  label,
  rows,
  onOpenJob,
}: {
  label: string;
  rows: SubJobRow[];
  onOpenJob: (projectId: string, opts?: OpenJobOptions) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <p className="label mb-2 px-1">{label}</p>
      <ul className="card divide-y divide-[var(--line)] overflow-hidden">
        {rows.map((row) => (
          <li key={row.project_id}>
            <JobRowButton row={row} onOpen={() => onOpenJob(row.project_id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Name (17px bold), then "Peabody · Demo · Mon–Tue (penciled in)", then ›. */
function JobRowButton({ row, onOpen }: { row: SubJobRow; onOpen: () => void }) {
  const line = [row.town, row.summary].filter(Boolean).join(" · ");
  return (
    <button type="button" onClick={onOpen} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[17px] font-bold leading-snug">{row.name}</span>
          {row.here_now && (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--accent-dark)] px-2.5 py-0.5 text-[13px] font-bold text-white">
              Here now
            </span>
          )}
        </span>
        {line && <span className="block truncate text-[15px] text-[var(--muted)]">{line}</span>}
      </span>
      <span aria-hidden className="shrink-0 text-[24px] font-bold leading-none text-[var(--muted)]">
        ›
      </span>
    </button>
  );
}
