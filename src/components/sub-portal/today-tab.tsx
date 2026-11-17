"use client";

import { Empty } from "@/components/portal-kit/empty";
import { projectTypeLabel } from "@/lib/constants/project";
import { fmtShort, fmtTime, fmtWeekday, telHref } from "@/lib/portal-kit/format";
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
  search,
  onSearch,
  needed,
  preview,
  canFixBill,
  onOpenJob,
  onAnswerDates,
  onSign,
  onFixBill,
}: {
  data: SubHomePayload;
  search: string;
  onSearch: (value: string) => void;
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
  const jobCount = today.length + this_week.length + other.length;
  const query = jobCount > 1 ? search.trim().toLowerCase() : "";
  const sections = [
    { label: "Today", rows: today },
    { label: "Next 7 days", rows: this_week },
    { label: "Other open jobs", rows: other },
  ].map(({ label, rows }) => ({
    label,
    rows: query ? rows.filter((job) =>
      [job.name, job.address, job.town, job.project_number, projectTypeLabel(job.project_type), job.phase?.name]
        .some((value) => value?.toLowerCase().includes(query)),
    ) : rows,
  }));

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

      <div className="flex items-end justify-between gap-3 px-1 pt-2">
        <div>
          <p className="text-[14px] font-bold text-[var(--accent-dark)]">{fmtWeekday(data.today)} · {fmtShort(data.today)}</p>
          <h1 className="mt-0.5 text-[30px] font-extrabold leading-tight tracking-tight">Your jobs</h1>
        </div>
        {jobCount > 0 && <p className="pb-1 text-[15px] font-semibold text-[var(--muted)]">{jobCount} open</p>}
      </div>
      {jobCount === 0 ? (
        <Empty action={<a href={telHref(data.flags.office_phone)} className="btn btn-ghost">Call the office</a>}>
          No open jobs assigned. If you’re scheduled on site, call Penney to check your assignment.
        </Empty>
      ) : (
        <>
          {jobCount > 1 && (
            <input
              aria-label="Find a job by name, address, number, type or phase"
              type="search"
              placeholder="Find a job by name or address"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 text-[16px] placeholder:text-[var(--muted)]"
            />
          )}
          {sections.map(({ label, rows }) => (
            <JobSection key={label} label={label} rows={rows} onOpenJob={onOpenJob} />
          ))}
          {query && sections.every(({ rows }) => rows.length === 0) && (
            <Empty action={<button type="button" onClick={() => onSearch("")} className="btn btn-ghost">Show all jobs</button>}>
              No jobs match your search.
            </Empty>
          )}
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

/** Keep the office's job grouping and order as the list is filtered. */
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
      <h2 className="mb-2 px-1 text-[17px] font-extrabold">{label}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.project_id} className="card relative isolate flex min-w-0 flex-col">
            <div className="flex flex-1 flex-col px-4 pb-3 pt-4">
              <span className="flex w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[13px] font-bold">
                <span className="text-[var(--accent-dark)]">{[row.project_number, projectTypeLabel(row.project_type)].filter(Boolean).join(" · ")}</span>
                {row.here_now && <span className="text-[var(--ink)]">Checked in</span>}
              </span>
              <span className="mt-1 break-words text-[20px] font-extrabold leading-tight">{row.name}</span>
              {(row.address || row.town) && <span className="mt-1 break-words text-[15px] text-[var(--muted)]">{row.address || row.town}</span>}
              <span className="mt-3 border-l-2 border-[var(--accent)] pl-2.5 text-[15px] font-semibold">{row.summary}</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-[var(--line)] border-t border-[var(--line)]">
              <button type="button" aria-label={`Job brief for ${row.name}`} onClick={() => onOpenJob(row.project_id)} className="min-h-11 rounded-bl-2xl bg-[var(--paper)]/50 px-2 text-[15px] font-bold text-[var(--accent-dark)] after:absolute after:inset-0 after:rounded-2xl">Job brief <span aria-hidden>›</span></button>
              <button type="button" aria-label={`Plans and files for ${row.name}`} onClick={() => onOpenJob(row.project_id, { view: "drawings" })} className="relative min-h-11 rounded-br-2xl px-2 text-[15px] font-bold">Plans &amp; files</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
