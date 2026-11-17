"use client";

import {
  ArrowRight, Bath, CalendarCheck, CalendarDays, Camera, ClipboardCheck,
  CookingPot, FileSignature, FolderOpen, Hammer, HardHat, House, HousePlus, ListChecks,
  MapPin, MapPinCheck, ReceiptText, Search,
} from "lucide-react";
import { Empty } from "@/components/portal-kit/empty";
import { projectTypeLabel } from "@/lib/constants/project";
import { fmtTime, telHref } from "@/lib/portal-kit/format";
import type { SubHomePayload, SubJobRow, SubNeededItem, SubVisitSummary } from "@/lib/sub-portal/payload";
import type { OpenJobOptions } from "./sub-portal-view";

/**
 * Jobs keep the office's order within each schedule group. A sign scan
 * gives the job a check-in card and any open requests sit beside the board
 * on desktop or above the jobs on phones.
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

  const hasRail = !!here || needed.length > 0;
  const matches = sections.reduce((total, section) => total + section.rows.length, 0);
  const day = new Date(`${data.today}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });

  return (
    <div className="pc-jobboard">
      <style>{JOB_BOARD_CSS}</style>
      <header className="jb-masthead">
        <div>
          <time dateTime={data.today}><CalendarDays size={16} aria-hidden />{day}</time>
          <h1>Your jobs</h1>
        </div>
        {jobCount > 1 && (
          <div className="jb-search">
            <Search size={19} aria-hidden />
            <input aria-label="Find a job by name, address, number, type or phase" type="search"
              placeholder="Search jobs or addresses" value={search} onChange={e => onSearch(e.target.value)} />
          </div>
        )}
      </header>
      <div className={hasRail ? "jb-layout jb-has-rail" : "jb-layout"}>
        {hasRail && (
          <aside className="jb-rail" aria-label="Site activity and requests">
            {here && (
              <HereNowCard
                visit={here}
                clockedInSince={data.clock?.project_id === here.project_id ? data.clock.started_at : null}
                onAddPhotos={() => onOpenJob(here.project_id, { compose: true })}
              />
            )}

            {needed.length > 0 && (
              <section className="jb-requests">
                <h2><ListChecks size={20} aria-hidden />Needed from you <span>{needed.length}</span></h2>
                <ul>
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
          </aside>
        )}
        <div className="jb-jobs">
          {jobCount === 0 ? (
            <Empty action={<a href={telHref(data.flags.office_phone)} className="btn btn-ghost">Call the office</a>}>
              No open jobs assigned. If you’re scheduled on site, call Penney to check your assignment.
            </Empty>
          ) : (
            <>
              {query && <p role="status" className="jb-result-count">{matches} of {jobCount} jobs</p>}
              {sections.map(({ label, rows }) => (
                <JobSection key={label} label={label} rows={rows} current={label === "Today"} onOpenJob={onOpenJob} />
              ))}
              {query && matches === 0 && (
                <Empty action={<button type="button" onClick={() => onSearch("")} className="btn btn-ghost">Show all jobs</button>}>
                  No jobs match your search.
                </Empty>
              )}
            </>
          )}
        </div>
      </div>
    </div>
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
    <section className="jb-here">
      <h2><MapPinCheck size={19} aria-hidden />Here now</h2>
      <p className="jb-here-job">{visit.project_name}</p>
      <p className="jb-here-time">Checked in at {fmtTime(visit.first_seen_at)}</p>
      <p className="jb-here-detail">
        {posts}
        {photos}
        {clockedInSince ? ` · on the clock since ${fmtTime(clockedInSince)}` : ""}
      </p>
      <button type="button" onClick={onAddPhotos}>
        <Camera size={18} aria-hidden />Add today&apos;s photos
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
  const Icon = { answer_dates: CalendarCheck, sign_agreement: FileSignature, bill_returned: ReceiptText, add_photos: Camera }[item.kind];
  return (
    <li className="jb-request">
      <Icon size={18} aria-hidden />
      <div>
        <p className="jb-request-title">{item.title}</p>
        {detail && <p className="jb-request-detail">{detail}</p>}
      <button
        type="button"
        onClick={onTap ?? undefined}
        disabled={!onTap}
        title={!onTap && preview ? "Not available in the preview" : undefined}
        className="jb-request-action"
      >
        {item.action_label}<ArrowRight size={15} aria-hidden />
      </button>
      </div>
    </li>
  );
}

/** Keep the office's job grouping and order as the list is filtered. */
function JobSection({
  label,
  rows,
  current,
  onOpenJob,
}: {
  label: string;
  rows: SubJobRow[];
  current: boolean;
  onOpenJob: (projectId: string, opts?: OpenJobOptions) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className={current ? "jb-group jb-current" : "jb-group"}>
      <div className="jb-section-title">
        <h2>{label}</h2>
        <span>{rows.length} {rows.length === 1 ? "job" : "jobs"}</span>
      </div>
      <ul className="jb-grid">
        {rows.map(row => <JobCard key={row.project_id} row={row} onOpenJob={onOpenJob} />)}
      </ul>
    </section>
  );
}

const TYPE_ICONS = { addition: HousePlus, new_construction: House, bathroom: Bath, remodel: Hammer, kitchen: CookingPot };
const JOB_STATUS: Record<string, string> = { in_progress: "In progress", on_hold: "On hold", contracted: "Contracted" };

function JobCard({ row, onOpenJob }: {
  row: SubJobRow;
  onOpenJob: (projectId: string, opts?: OpenJobOptions) => void;
}) {
  const type = projectTypeLabel(row.project_type);
  const Icon = type ? TYPE_ICONS[row.project_type as keyof typeof TYPE_ICONS] ?? HardHat : HardHat;
  const status = row.here_now ? "Checked in" : JOB_STATUS[row.status];
  const address = row.address || row.town;
  const phase = row.phase?.name;
  const prefix = `${phase} · `;
  const detail = phase && row.summary.startsWith(prefix) ? row.summary.slice(prefix.length) : row.summary;
  return (
    <li className="jb-card">
      <div className="jb-identity">
        <div className="jb-card-head">
          <span className="jb-type-icon"><Icon size={23} strokeWidth={1.6} aria-hidden /></span>
          <div className="jb-identifiers">
            {type && <span className="jb-type">{type}</span>}
            {row.project_number && <span className="jb-number">{row.project_number}</span>}
          </div>
          {status && <span className={`jb-status jb-status-${row.here_now ? "here" : row.status}`}><i aria-hidden />{status}</span>}
        </div>
        <h3>{row.name}</h3>
        {address && <p className="jb-address"><MapPin size={15} aria-hidden />{address}</p>}
      </div>
      <div className="jb-work">
        {phase ? <CalendarDays size={18} aria-hidden /> : <ClipboardCheck size={18} aria-hidden />}
        <div>{phase && <strong>{phase}</strong>}{detail && detail !== phase && <span>{detail}</span>}</div>
      </div>
      <div className="jb-actions">
        <button type="button" className="jb-primary" aria-label={`Job brief for ${row.name}`}
          onClick={() => onOpenJob(row.project_id)}>Job brief <ArrowRight size={16} aria-hidden /></button>
        <button type="button" className="jb-secondary" aria-label={`Plans and files for ${row.name}`}
          onClick={() => onOpenJob(row.project_id, { view: "drawings" })}><FolderOpen size={17} aria-hidden />Plans &amp; files</button>
      </div>
    </li>
  );
}

// Scoped to the job board. Container queries follow the actual job column,
// including a narrow board beside the desktop requests panel.
const JOB_BOARD_CSS = `
.pc-jobboard { --jb-clay-wash: #f6eae2; --jb-surface: #faf8f5; min-width: 0; }
.pc-jobboard svg { flex-shrink: 0; }
.pc-jobboard :is(button,input):focus-visible { outline: 3px solid var(--accent-dark); outline-offset: 3px; }
.jb-masthead { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 32px; margin-bottom: 25px; }
.jb-masthead time { display: inline-flex; align-items: center; gap: 8px; color: var(--accent-dark); font-size: 14px; font-weight: 750; }
.jb-masthead h1 { margin: 4px 0 0; font-size: clamp(40px, 5vw, 62px); line-height: 1.03; font-weight: 800; letter-spacing: -.055em; }
.jb-search { display: flex; align-items: center; gap: 10px; width: min(100%, 320px); padding: 0 15px; border: 1px solid #cbc6bb; border-radius: 12px; background: var(--card); color: var(--muted); }
.jb-search:focus-within { outline: 2px solid var(--accent-dark); outline-offset: 2px; }
.jb-search input { width: 100%; min-width: 0; min-height: 48px; background: transparent; color: var(--ink); }
.pc-jobboard .jb-search input:focus-visible { outline: none; }
.jb-search input::placeholder { color: var(--muted); opacity: 1; }
.jb-layout, .jb-jobs, .jb-rail { min-width: 0; display: grid; align-content: start; gap: 22px; }
.jb-jobs { container: joblist / inline-size; }
.jb-rail { gap: 16px; align-items: start; }
.jb-section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 13px; }
.jb-section-title h2 { margin: 0; font-size: clamp(21px, 2.1vw, 26px); line-height: 1.18; font-weight: 800; letter-spacing: -.035em; }
.jb-section-title > span, .jb-result-count { color: var(--muted); font-size: 14px; font-weight: 650; }
.jb-grid { display: grid; gap: 15px; grid-template-columns: minmax(0, 1fr); }
.jb-card { position: relative; isolation: isolate; min-width: 0; display: grid; grid-template-rows: 1fr auto auto; padding: clamp(16px, 2.2vw, 24px); border: 1px solid #d9d5cc; border-radius: 18px; background: var(--card); box-shadow: 0 2px 4px rgb(49 37 25 / 4%); }
.jb-current .jb-card { border-top: 3px solid var(--accent); }
.jb-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.jb-type-icon { display: grid; place-items: center; flex: 0 0 41px; height: 41px; background: var(--jb-clay-wash); color: var(--accent-dark); border-radius: 11px; }
.jb-identifiers { display: grid; line-height: 1.3; min-width: 0; flex: 1; }
.jb-type { color: var(--ink); font-size: 14px; font-weight: 750; }
.jb-number { font-size: 13px; font-weight: 650; color: var(--muted); font-variant-numeric: tabular-nums; }
.jb-status { display: inline-flex; align-items: center; gap: 5px; border-radius: 6px; background: #f1f0eb; color: #4c5350; padding: 4px 7px; font-size: 13px; line-height: 1.2; font-weight: 650; }
.jb-status i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.jb-status-in_progress, .jb-status-here { background: #edf1eb; color: #405b48; }
.jb-status-on_hold { background: #fbefd8; color: #805719; }
.jb-identity h3, .jb-here-job { overflow-wrap: anywhere; }
.jb-identity h3 { margin: 15px 0 4px; font-weight: 800; font-size: clamp(21px, 2vw, 26px); line-height: 1.16; letter-spacing: -.035em; }
.jb-address { display: flex; align-items: flex-start; gap: 5px; color: var(--muted); font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.jb-address svg { margin-top: .16em; }
.jb-work { display: flex; align-items: flex-start; gap: 9px; background: var(--jb-surface); border: 1px solid #eeeae3; border-radius: 9px; padding: 10px 12px; margin-top: 18px; color: var(--muted); font-size: 14px; line-height: 1.4; }
.jb-work svg { margin-top: 1px; color: var(--accent-dark); }
.jb-work div { min-width: 0; overflow-wrap: anywhere; }
.jb-work strong, .jb-work span { display: block; }
.jb-work strong { color: var(--ink); font-size: 15px; line-height: 1.3; }
.jb-work strong + span { margin-top: 2px; }
.jb-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.jb-actions button, .jb-here button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 7px 10px; border-radius: 9px; font-size: 15px; line-height: 1.2; font-weight: 750; }
.jb-actions button { flex: 1 1 auto; }
.jb-primary { color: white; background: var(--accent-dark); }
.jb-primary::after { content: ""; position: absolute; inset: 0; border-radius: 18px; }
.jb-secondary { position: relative; z-index: 1; background: var(--card); border: 1px solid #cec9be; color: var(--ink); }
.jb-primary:focus-visible::after { outline: 2px solid var(--accent-dark); outline-offset: 2px; }
.jb-here { background: var(--ink); color: white; border-radius: 17px; padding: 19px; }
.jb-here h2, .jb-requests h2 { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 750; }
.jb-here h2 { color: #f7c4a8; }
.jb-here-job { margin: 12px 0 3px; font-size: 22px; font-weight: 750; line-height: 1.22; letter-spacing: -.03em; }
.jb-here-time, .jb-here-detail { color: #e1e5df; font-size: 14px; }
.jb-here-detail { margin-top: 4px; }
.jb-here button { margin-top: 16px; background: #fff; color: var(--ink); width: 100%; }
.jb-requests { background: var(--card); border: 1px solid var(--line); border-radius: 17px; padding: 17px; }
.jb-requests h2 { padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.jb-requests h2 svg, .jb-request > svg { color: var(--accent-dark); }
.jb-requests h2 span { margin-left: auto; padding: 2px 8px; font-size: 13px; border-radius: 6px; background: var(--jb-clay-wash); color: var(--accent-dark); }
.jb-request { display: flex; gap: 9px; padding-top: 13px; }
.jb-request + .jb-request { border-top: 1px solid var(--line); }
.jb-request > svg { margin-top: 2px; }
.jb-request > div { min-width: 0; }
.jb-request-title { font-size: 15px; font-weight: 750; line-height: 1.4; overflow-wrap: anywhere; }
.jb-request-detail { color: var(--muted); font-size: 14px; line-height: 1.45; margin-top: 3px; overflow-wrap: anywhere; }
.jb-request-action { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-size: 15px; font-weight: 750; color: var(--accent-dark); }
.jb-request-action:disabled { opacity: .55; }
@media (hover:hover) {
  .jb-card:has(.jb-primary:hover) { border-color: var(--accent); }
  .jb-primary:hover { background: #82401f; }
  .jb-secondary:hover, .jb-here button:hover { background: var(--jb-clay-wash); }
  .jb-request-action:hover:not(:disabled) { text-decoration: underline; }
}
@media (max-width: 590px) {
  .jb-masthead { align-items: stretch; flex-direction: column; margin-bottom: 22px; }
  .jb-search { width: 100%; }
}
@media (min-width: 680px) {
  .jb-masthead { margin-bottom: 32px; }
  .jb-layout, .jb-jobs { gap: 30px; }
  .jb-rail:has(> :nth-child(2)) { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
@media (min-width: 1040px) {
  .jb-layout.jb-has-rail { grid-template-columns: minmax(0, 1fr) minmax(245px, 26%); align-items: start; }
  .jb-has-rail .jb-jobs { grid-row: 1; grid-column: 1; }
  .jb-has-rail .jb-rail { grid-row: 1; grid-column: 2; padding-top: 4px; grid-template-columns: minmax(0,1fr); }
}
@container joblist (min-width: 36rem) {
  .jb-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .jb-card:only-child { grid-column: 1 / -1; grid-template-columns: minmax(0,1fr) minmax(225px,.78fr); grid-template-rows: auto auto; align-items: center; column-gap: 25px; }
  .jb-card:only-child .jb-identity { grid-column: 1; grid-row: span 2; }
  .jb-card:only-child .jb-work, .jb-card:only-child .jb-actions { grid-column: 2; }
  .jb-card:only-child .jb-work { margin-top: 0; }
  .jb-card:only-child .jb-actions { margin-top: 9px; }
}
@container joblist (min-width: 61rem) {
  .jb-grid { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .jb-grid:has(> :nth-child(2):last-child) { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .jb-card:only-child { grid-template-columns: minmax(0,1.2fr) minmax(0,.84fr) minmax(200px,.6fr); grid-template-rows: auto; }
  .jb-card:only-child .jb-identity { grid-row: 1; }
  .jb-card:only-child .jb-actions { grid-column: 3; margin: 0; flex-direction: column; }
}
`;
