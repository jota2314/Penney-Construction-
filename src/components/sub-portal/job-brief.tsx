import { TimelineList, TimelineRow, type TimelineChip } from "@/components/portal-kit/timeline-row";
import { ArrowRight, ChevronDown, ClipboardCheck } from "lucide-react";
import { FieldDocumentLink } from "@/components/sub-portal/job-drawings";
import { fmtDate } from "@/lib/portal-kit/format";
import { priceFreeScopeText } from "@/lib/site-qr/scope-text";
import type { SubDatePhase, SubJobPayload, SubSelection } from "@/lib/sub-portal/payload";

const heading = "mb-3 text-[21px] font-extrabold leading-tight tracking-[-0.035em] sm:text-[24px]";
const disclosure = "min-h-11 cursor-pointer px-4 py-3 text-[15px] font-bold marker:text-[var(--accent-dark)] sm:px-5";
const cap = (s: string) => s.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());

export function JobBrief({ data, onFiles, onAnswerDates }: {
  data: SubJobPayload;
  onFiles: () => void;
  onAnswerDates?: (phaseId: string) => void;
}) {
  const overview = data.approved_scope;
  const sections = overview?.sections.filter((section) => section.items.length > 0) ?? [];
  const featured = sections.slice(0, 2);
  const scopeCount = sections.reduce((total, section) => total + section.items.length, 0);
  const hasFullScope = scopeCount > featured.length || featured.some((s) => s.items[0].description.length > 240);
  const commitments = [
    ...data.agreements.filter((a) => a.status === "signed").map((a) => ({
      key: a.id,
      source: `Signed ${a.kind === "change_order" ? "change order" : "work order"} · ${a.number}`,
      title: priceFreeScopeText(a.title),
      scope: priceFreeScopeText(a.scope_text),
    })),
    ...data.quotes.filter((q) => q.stage === "awarded").map((q) => ({
      key: `${q.source}-${q.id}`,
      source: `Awarded ${q.source}`,
      title: priceFreeScopeText(q.title),
      scope: priceFreeScopeText(q.scope),
    })),
  ];
  const upcoming = data.dates.filter((p) => p.bucket !== "past");
  const past = data.dates.filter((p) => p.bucket === "past");
  const files = data.files.flatMap((g) => g.docs);
  const document = data.files.find((g) => g.key === "drawings")?.docs[0] ?? files[0];

  return (
    <div className="grid min-w-0 items-start gap-6 [overflow-wrap:anywhere] sm:gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,1fr)]">
      <div className="min-w-0 space-y-5 sm:space-y-7">
        <section aria-labelledby="job-scope-title" className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="px-5 pb-4 pt-5 sm:px-7 sm:pb-5 sm:pt-7">
            <h2 id="job-scope-title" className="text-[25px] font-extrabold leading-tight tracking-[-0.04em] sm:text-[32px]">What we’re building</h2>
            {featured.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[13px] font-semibold text-[var(--muted)]">
                <ClipboardCheck aria-hidden size={15} className="text-[var(--accent-dark)]" />
                {overview?.source?.status === "signed" ? "Signed project scope" : "Approved project scope"}
                {overview?.source?.date && ` · ${fmtDate(overview.source.date)}`}
              </p>
            )}
            {featured.length === 0 && <p className="mt-3 text-[16px] text-[var(--muted)]">{overview?.unavailableReason || "The project scope is unavailable here. Contact Penney for the current scope."}</p>}
            {featured.length > 0 && (
              <ul className="mt-5 space-y-4 border-t border-[var(--line)] pt-4 sm:mt-6 sm:pt-5">
                {featured.map(({ id, label, items: [item] }) => (
                  <li key={id} className="border-l-2 border-[var(--accent)] pl-3.5">
                    <p className="text-[13px] font-extrabold text-[var(--accent-dark)]">{cap(label)}</p>
                    <h3 className="mt-0.5 text-[18px] font-bold leading-snug tracking-tight sm:text-[20px]">{item.title}</h3>
                    {item.description && <p className={`mt-1 max-w-[65ch] whitespace-pre-line text-[15px] leading-relaxed text-[var(--muted)] sm:text-base ${hasFullScope ? "line-clamp-3" : ""}`}>{item.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {hasFullScope && (
            <details className="group/scope border-t border-[var(--line)]">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 bg-[var(--paper)]/60 px-5 py-2.5 text-[15px] font-bold text-[var(--accent-dark)] sm:px-7 [&::-webkit-details-marker]:hidden">
                View full project scope ({scopeCount} {scopeCount === 1 ? "item" : "items"})
                <ChevronDown aria-hidden size={17} className="shrink-0 group-open/scope:rotate-180" />
              </summary>
              {sections.map((section) => (
                <details key={section.id} className="border-t border-[var(--line)]">
                  <summary className={disclosure}>
                    {cap(section.label)}
                    <span className="ml-2 text-[13px] font-semibold text-[var(--muted)]">{section.items.length} {section.items.length === 1 ? "item" : "items"}</span>
                  </summary>
                  <ul className="space-y-3 border-t border-[var(--line)] bg-[var(--paper)] px-4 py-3">
                    {section.items.map((item, i) => (
                      <li key={i}>
                        <p className="font-bold">{item.title}</p>
                        {item.description && <p className="mt-0.5 whitespace-pre-line text-[16px]">{item.description}</p>}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </details>
          )}
        </section>

        <section aria-labelledby="company-work-title" className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="border-b border-[var(--line)] bg-[#F4EDE5] px-5 py-4 sm:px-7">
            <h2 id="company-work-title" className="text-[23px] font-extrabold leading-tight tracking-[-0.035em] sm:text-[26px]">Your company’s work</h2>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {data.assignment_summary && (
              <div className="px-5 py-5 sm:px-7">
                <p className="text-[13px] font-bold text-[var(--accent-dark)]">Job assignment</p>
                <p className="mt-1.5 max-w-[65ch] whitespace-pre-line text-[17px] font-semibold leading-relaxed">{data.assignment_summary}</p>
              </div>
            )}
            {commitments.map((work) => (
              <div key={work.key} className="px-5 py-4 sm:px-7">
                <p className="text-[13px] font-bold text-[var(--accent-dark)]">{work.source}</p>
                {work.title && <p className="mt-1 font-bold">{work.title}</p>}
                <p className="mt-1 whitespace-pre-line">{work.scope || "No scope details posted for this item. Check with Penney before starting."}</p>
              </div>
            ))}
            {!data.assignment_summary && commitments.length === 0 && (
              <p className="p-4 text-[16px] text-[var(--muted)]">Penney hasn’t posted a scope for your company here. Contact your project manager to confirm the work.</p>
            )}
            {data.scope.length > 0 && (
              <details>
                <summary className={disclosure}>Estimate reference for your trade</summary>
                <ul className="space-y-3 px-4 pb-4">
                  {data.scope.map((s, i) => (
                    <li key={i}>
                      {s.trade && <p className="label">{cap(s.trade)}</p>}
                      {s.description && <p className="font-bold">{s.description}</p>}
                      {s.scope && <p className="whitespace-pre-line">{s.scope}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>

      </div>
      <aside aria-label="Field references" className="grid min-w-0 items-start gap-6 sm:grid-cols-2 lg:grid-cols-1">
        <section className="min-w-0">
          <div className="overflow-hidden rounded-2xl bg-[var(--ink)] text-white">
            <h2 className="px-5 pt-5 text-[22px] font-extrabold tracking-[-0.035em] sm:px-6">Plans &amp; files</h2>
            {document && <FieldDocumentLink document={document} featured />}
            {data.files_unavailable && <p className="px-5 py-4 text-white/85">Some files couldn’t load. Open Plans &amp; files to retry.</p>}
            {!document && !data.files_unavailable && <p className="px-5 pb-5 pt-3 text-white/85">Penney hasn’t posted plans or files for this job yet.</p>}
            {(document || data.files_unavailable) && (
              <button type="button" onClick={onFiles} className="flex min-h-12 w-full items-center justify-between gap-3 border-t border-white/20 px-5 text-left text-[15px] font-bold text-white hover:bg-white/10 sm:px-6">
                {data.files_unavailable ? "Open plans & files" : `All job files (${files.length})`}
                <ArrowRight aria-hidden size={17} />
              </button>
            )}
          </div>
        </section>

        <section>
          <h2 className={heading}>Your dates on this job</h2>
          {upcoming.length > 0 ? (
            <TimelineList>{upcoming.map((p) => <DateRow key={p.id} phase={p} onAnswerDates={onAnswerDates} />)}</TimelineList>
          ) : (
            <p className="card p-4 text-[var(--muted)]">No upcoming dates posted for you.</p>
          )}
          {past.length > 0 && (
            <details className="mt-2">
              <summary className={disclosure}>Past dates ({past.length})</summary>
              <TimelineList>{past.map((p) => <DateRow key={p.id} phase={p} />)}</TimelineList>
            </details>
          )}
        </section>

        <section>
          <h2 className={heading}>Fixtures &amp; selections</h2>
          {data.selections.length > 0 ? (
            <ul className="card divide-y divide-[var(--line)]">{data.selections.map((s) => <SelectionRow key={s.id} selection={s} />)}</ul>
          ) : (
            <p className="card p-4 text-[var(--muted)]">No selections posted for this job yet.</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function dateChip(p: SubDatePhase): TimelineChip {
  if (p.status === "completed") return "done";
  if (p.status === "on_hold") return { label: "On hold", color: "#7A5A1E" };
  if (p.sub_response === "declined") return "declined";
  if (p.needs_answer) return "answer";
  if (p.status === "in_progress") return "now";
  return p.firm ? "confirmed" : "penciled";
}

function DateRow({ phase: p, onAnswerDates }: { phase: SubDatePhase; onAnswerDates?: (phaseId: string) => void }) {
  return (
    <TimelineRow
      name={p.name}
      description={p.description}
      shape={p.event_type === "inspection" ? "diamond" : "dot"}
      chip={dateChip(p)}
      filled={p.status === "completed" || p.status === "in_progress"}
      highlight={p.status === "in_progress"}
      muted={p.bucket === "past"}
      start={p.start_date}
      end={p.end_date}
      firm={p.firm}
      actions={onAnswerDates && p.needs_answer && p.status !== "completed" && p.status !== "on_hold" && (
        <button type="button" className="btn btn-ghost" onClick={() => onAnswerDates(p.id)} aria-label={`Answer dates for ${p.name}`}>
          Answer dates
        </button>
      )}
    >
      {p.sub_response_note && <p className="mt-1 text-[15px] text-[var(--muted)]">You said: {p.sub_response_note}</p>}
    </TimelineRow>
  );
}

const SELECTION_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Not picked yet", color: "#5F6763" },
  selected: { label: "Picked", color: "#2F6B4F" },
  ordered: { label: "Ordered", color: "var(--ink)" },
  delivered: { label: "Delivered", color: "#2F6B4F" },
  installed: { label: "Installed", color: "#2F6B4F" },
};

function SelectionRow({ selection: s }: { selection: SubSelection }) {
  const pill = SELECTION_STATUS[s.status] ?? { label: cap(s.status || "pending"), color: "#5F6763" };
  return (
    <li className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label">{s.category}</p>
          <p className="text-[17px] font-bold leading-snug">{s.selected_value || s.description || "To be picked"}</p>
          {s.selected_value && s.description && <p className="text-[15px] text-[var(--muted)]">{s.description}</p>}
        </div>
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-bold text-white" style={{ background: pill.color }}>{pill.label}</span>
      </div>
    </li>
  );
}
