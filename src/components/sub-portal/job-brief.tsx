import { TimelineList, TimelineRow, type TimelineChip } from "@/components/portal-kit/timeline-row";
import { fmtDate } from "@/lib/portal-kit/format";
import { priceFreeScopeText } from "@/lib/site-qr/scope-text";
import type { SubDatePhase, SubJobPayload, SubSelection } from "@/lib/sub-portal/payload";

const heading = "mb-2 text-[19px] font-extrabold leading-tight";
const disclosure = "cursor-pointer px-4 py-3 text-[16px] font-bold marker:text-[var(--accent-dark)]";
const cap = (s: string) => s.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());

export function JobBrief({ data, onFiles, onAnswerDates }: {
  data: SubJobPayload;
  onFiles: () => void;
  onAnswerDates?: (phaseId: string) => void;
}) {
  const overview = data.approved_scope;
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
    <div className="space-y-6 [overflow-wrap:anywhere]">
      <section className="card overflow-hidden">
        <div className="border-l-4 border-[var(--accent)] px-4 py-4">
          <h3 className="text-[21px] font-extrabold leading-tight">What we’re building</h3>
          {overview?.sections.length ? (
            <p className="mt-1 text-[15px] text-[var(--muted)]">
              {overview.source?.status === "signed" ? "Signed project scope" : "Approved project scope"}
              {overview.source?.date && ` · ${fmtDate(overview.source.date)}`}
            </p>
          ) : (
            <p className="mt-2 text-[16px] text-[var(--muted)]">
              {overview?.unavailableReason || "The project scope is unavailable here. Contact Penney for the current scope."}
            </p>
          )}
        </div>
        {!!overview?.sections.length && (
          <details className="group/scope border-t border-[var(--line)]">
            <summary className={disclosure}>
              Read the full project scope
              <span className="mt-2 grid gap-1 font-normal text-[var(--muted)] group-open/scope:hidden">
                {overview.sections.slice(0, 3).map((s) => (
                  <span key={s.id} className="line-clamp-2">
                    <strong className="font-semibold text-[var(--ink)]">{cap(s.label)}</strong> · {s.items[0]?.title}
                  </span>
                ))}
              </span>
            </summary>
            {overview.sections.map((section) => (
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

      <section>
        <h3 className={heading}>Your company’s work</h3>
        <div className="card divide-y divide-[var(--line)]">
          {data.assignment_summary && (
            <div className="p-4">
              <p className="text-[13px] font-bold text-[var(--accent-dark)]">Job assignment</p>
              <p className="mt-1 whitespace-pre-line">{data.assignment_summary}</p>
            </div>
          )}
          {commitments.map((work) => (
            <div key={work.key} className="p-4">
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

      <section>
        <h3 className={heading}>Plans &amp; files</h3>
        <div className="card overflow-hidden">
          {document && (
            <a href={document.url} target="_blank" rel="noreferrer" className="flex min-h-[60px] items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="label block">{document.group === "drawings" ? "Current drawing" : "Job file"}</span>
                <span className="block font-bold">{document.title}</span>
                <span className="block text-[14px] text-[var(--muted)]">
                  {[document.subtitle, document.date && fmtDate(document.date)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span aria-hidden className="text-[var(--accent-dark)]">↗</span>
            </a>
          )}
          {data.files_unavailable && <p className="px-4 py-3 text-[var(--muted)]">Some files couldn’t load. Open Plans &amp; files to retry.</p>}
          {!document && !data.files_unavailable && <p className="p-4 text-[var(--muted)]">Penney hasn’t posted plans or files for this job yet.</p>}
          {(document || data.files_unavailable) && (
            <button type="button" onClick={onFiles} className="min-h-[48px] w-full border-t border-[var(--line)] px-4 text-left font-bold text-[var(--accent-dark)]">
              {data.files_unavailable ? "Open plans & files" : `See all ${files.length} ${files.length === 1 ? "file" : "files"}`} ›
            </button>
          )}
        </div>
      </section>

      <section>
        <h3 className={heading}>Your dates on this job</h3>
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
        <h3 className={heading}>Fixtures &amp; selections</h3>
        {data.selections.length > 0 ? (
          <ul className="card divide-y divide-[var(--line)]">{data.selections.map((s) => <SelectionRow key={s.id} selection={s} />)}</ul>
        ) : (
          <p className="card p-4 text-[var(--muted)]">No selections posted for this job yet.</p>
        )}
      </section>
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
