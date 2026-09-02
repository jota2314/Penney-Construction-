"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ClipboardList, FileText } from "lucide-react";
import type { JobRollup } from "./types";
import {
  Card,
  DirectionsLink,
  EmptyState,
  FILE_LABELS,
  MONO,
  Pill,
  ProgressBar,
  SectionLabel,
  fmt,
  fmtDate,
  fmtShortDate,
  quoteStatusLabel,
  statusLabel,
} from "./ui";

/**
 * Jobs: one card per live job, tap to open. Awarded price is the headline;
 * the detail carries scope, his quotes with a plain status, billing, drawings,
 * selections, inspections and dates. Finished jobs fold under "Past jobs".
 */
export function JobsTab({
  jobs,
  pastJobs,
  openJob,
  onToggle,
}: {
  jobs: JobRollup[];
  pastJobs: JobRollup[];
  openJob: string | null;
  onToggle: (id: string | null) => void;
}) {
  if (jobs.length === 0 && pastJobs.length === 0) {
    return <EmptyState icon={ClipboardList} title="No jobs on file yet" body="Once we send you a job, it shows up here." />;
  }

  return (
    <div className="space-y-3">
      {jobs.length === 0 && (
        <p className="py-6 text-center text-[13px] text-stone-500">No active jobs right now.</p>
      )}
      {jobs.map((j) => (
        <JobCard key={j.proj.id} job={j} open={openJob === j.proj.id} onToggle={() => onToggle(openJob === j.proj.id ? null : j.proj.id)} />
      ))}

      {pastJobs.length > 0 && (
        <details className="pt-4" open={pastJobs.some((j) => j.proj.id === openJob)}>
          <summary className="cursor-pointer text-[11px] uppercase tracking-[0.24em] text-stone-500" style={MONO}>
            Past jobs ({pastJobs.length})
          </summary>
          <div className="mt-3 space-y-2.5">
            {pastJobs.map((j) => (
              <JobCard key={j.proj.id} job={j} open={openJob === j.proj.id} onToggle={() => onToggle(openJob === j.proj.id ? null : j.proj.id)} compact />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function JobCard({ job, open, onToggle, compact = false }: { job: JobRollup; open: boolean; onToggle: () => void; compact?: boolean }) {
  const { proj, agreed, pendingPrice, billing, inspections } = job;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);

  const statusTone =
    proj.status === "in_progress" ? "emerald" : proj.status === "contracted" ? "amber" : proj.status === "on_hold" ? "red" : "muted";
  const passed = inspections.filter((i) => i.status === "passed").length;

  return (
    <div ref={ref}>
      <Card className={`overflow-hidden ${compact && !open ? "opacity-80" : ""}`}>
        <button onClick={onToggle} className="w-full p-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={`${compact ? "text-[14px]" : "text-[16px]"} font-semibold text-stone-100`}>{proj.name}</p>
              <p className="mt-0.5 truncate text-[12px] text-stone-500" style={MONO}>
                {proj.project_number}
                {proj.address ? ` · ${proj.address}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              {agreed > 0 ? (
                <>
                  <p className="text-[16px] font-semibold text-amber-400" style={MONO}>{fmt(agreed)}</p>
                  <p className="text-[9px] uppercase tracking-[0.2em] text-amber-500/80" style={MONO}>Awarded</p>
                </>
              ) : pendingPrice > 0 ? (
                <Pill tone="neutral">Under review</Pill>
              ) : (
                <Pill tone="muted">No price yet</Pill>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill tone={statusTone}>{statusLabel(proj.status)}</Pill>
            {billing.open > 0.5 && <Pill tone="amber">Open {fmt(billing.open)}</Pill>}
            {billing.billed > 0 && billing.open <= 0.5 && <Pill tone="emerald">Paid {fmt(billing.paid)}</Pill>}
            {inspections.length > 0 && (
              <Pill tone={passed === inspections.length ? "emerald" : "neutral"}>
                Inspections {passed}/{inspections.length}
              </Pill>
            )}
          </div>

          {agreed > 0 && billing.paid > 0 && (
            <div className="mt-3">
              <ProgressBar value={billing.paid} max={Math.max(agreed, billing.billed)} />
              <p className="mt-1 text-[10px] text-stone-500" style={MONO}>
                {fmt(billing.paid)} paid of {fmt(Math.max(agreed, billing.billed))}
              </p>
            </div>
          )}

          <ChevronDown
            className={`mt-2 h-4 w-4 text-stone-600 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && <JobDetail job={job} />}
      </Card>
    </div>
  );
}

function JobDetail({ job }: { job: JobRollup }) {
  const { proj, awarded, quotes, bids, files, selections, phases, inspections, scope, billing } = job;
  const awardedQuotes = quotes.filter((q) => q.status === "accepted" || q.status === "approved");
  const otherQuotes = quotes.filter((q) => !(q.status === "accepted" || q.status === "approved"));

  return (
    <div className="space-y-6 border-t border-white/[0.06] px-4 py-4">
      {proj.address && (
        <DirectionsLink address={proj.address} />
      )}

      {/* your work — awarded first, then anything still open */}
      {(awarded.length > 0 || quotes.length > 0 || bids.length > 0) && (
        <section>
          <SectionLabel>Your work on this job</SectionLabel>
          <div className="space-y-2.5">
            {awarded.map((a) => (
              <div key={a.id} className="border-l-2 border-amber-500 pl-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[14px] font-medium text-stone-100">{a.description}</p>
                  {a.amount != null && <p className="shrink-0 text-[13px] text-amber-400" style={MONO}>{fmt(a.amount)}</p>}
                </div>
                <Pill tone="amber">Awarded</Pill>
                {a.scope && <p className="mt-1.5 text-[13px] leading-relaxed text-stone-400">{a.scope}</p>}
              </div>
            ))}
            {[...awardedQuotes, ...otherQuotes].map((q) => {
              const st = quoteStatusLabel(q.status);
              const isAwarded = st.tone === "amber";
              return (
                <div key={q.id} className={`border-l-2 pl-3 ${isAwarded ? "border-amber-500" : "border-white/15"}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[14px] font-medium text-stone-100">
                      {q.trade ? q.trade[0].toUpperCase() + q.trade.slice(1) : "Quote"}
                      {q.document_type && q.document_type !== "quote" && (
                        <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>{q.document_type}</span>
                      )}
                    </p>
                    {q.amount != null && (
                      <p className={`shrink-0 text-[13px] ${isAwarded ? "text-amber-400" : "text-stone-300"}`} style={MONO}>{fmt(q.amount)}</p>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Pill tone={st.tone}>{st.label}</Pill>
                    {q.received_at && (
                      <span className="text-[11px] text-stone-600" style={MONO}>{fmtShortDate(q.received_at.slice(0, 10))}</span>
                    )}
                  </div>
                  {q.scope && <p className="mt-1.5 text-[13px] leading-relaxed text-stone-400">{q.scope}</p>}
                  {q.pdf_url && (
                    <a href={q.pdf_url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-amber-500/90" style={MONO}>
                      <FileText className="h-3 w-3" /> Your quote (PDF)
                    </a>
                  )}
                </div>
              );
            })}
            {bids.map((b) => {
              const st = quoteStatusLabel(b.status);
              return (
                <div key={b.id} className={`border-l-2 pl-3 ${st.tone === "amber" ? "border-amber-500" : "border-white/15"}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[14px] font-medium text-stone-100">{b.package_name || b.trade || "Bid"}</p>
                    {b.amount != null && <p className="shrink-0 text-[13px] text-stone-300" style={MONO}>{fmt(b.amount)}</p>}
                  </div>
                  <div className="mt-1"><Pill tone={st.tone}>{st.label}</Pill></div>
                  {b.scope && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-stone-400">{b.scope}</p>}
                  {b.pdf_url && (
                    <a href={b.pdf_url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-amber-500/90" style={MONO}>
                      <FileText className="h-3 w-3" /> Your bid (PDF)
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* scope on the current proposal — descriptions only, no client pricing */}
      {scope.length > 0 && (
        <section>
          <SectionLabel>Scope of work</SectionLabel>
          <div className="space-y-2.5">
            {scope.map((s, i) => (
              <div key={i} className="border-l-2 border-white/15 pl-3">
                <p className="text-[14px] font-medium text-stone-100">
                  {s.description}
                  <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>{s.trade}</span>
                </p>
                {s.scope && <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-stone-400">{s.scope}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* billing on this job — his bills to us only */}
      {billing.rows.length > 0 && (
        <section>
          <SectionLabel right={<span className="text-[11px] text-stone-500" style={MONO}>{fmt(billing.paid)} paid · {fmt(billing.open)} open</span>}>
            Your billing
          </SectionLabel>
          <div className="space-y-1.5">
            {billing.rows.map((b) => (
              <div key={b.id} className="rounded-xl border border-white/[0.06] px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[13px] text-stone-200">
                    {b.invoice_number ? `Inv ${b.invoice_number}` : "Invoice"}
                    <span className="ml-2 text-[11px] text-stone-500" style={MONO}>{fmtDate(b.invoice_date)}</span>
                  </p>
                  <p className="shrink-0 text-[13px] text-stone-200" style={MONO}>{fmt(b.amount)}</p>
                </div>
                {b.description && <p className="mt-0.5 text-[12px] leading-relaxed text-stone-500">{b.description}</p>}
                <div className="mt-1.5">
                  {b.open > 0.5 ? (
                    <Pill tone="amber">Open {fmt(b.open)}{b.paid > 0.5 ? ` · paid ${fmt(b.paid)}` : ""}</Pill>
                  ) : (
                    <Pill tone="emerald">Paid{b.paid_date ? ` ${fmtShortDate(b.paid_date.slice(0, 10))}` : ""}</Pill>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* drawings + specs */}
      {files.length > 0 && (
        <section>
          <SectionLabel>Drawings &amp; specs</SectionLabel>
          <div className="space-y-1.5">
            {files.map((f) => (
              <a
                key={f.id}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5 transition-colors hover:border-amber-500/40"
              >
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-stone-200">
                  <FileText className="h-4 w-4 shrink-0 text-stone-500" />
                  <span className="truncate">{f.filename}</span>
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>
                  {FILE_LABELS[f.category] || f.category}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* fixtures / selections — always shown on a live job so "nothing
          picked yet" is visible instead of the section vanishing */}
      {job.isLive && (
        <section>
          <SectionLabel>Fixtures &amp; selections</SectionLabel>
          {selections.length === 0 ? (
            <p className="text-[13px] text-stone-600">Nothing picked yet. Call the office before you order anything.</p>
          ) : (
            <div className="space-y-1.5">
              {selections.map((s) => (
                <div key={s.id} className="rounded-xl border border-white/[0.06] px-3 py-2.5">
                  <p className="text-[13px] text-stone-200">
                    <span className="text-stone-500">{s.category}: </span>
                    {s.description || ""}
                  </p>
                  <p className="mt-0.5 text-[12px]" style={MONO}>
                    {s.selected_value ? <span className="text-emerald-400">{s.selected_value}</span> : <span className="text-stone-600">Not decided yet</span>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* inspections */}
      {(job.isLive || inspections.length > 0) && (
        <section>
          <SectionLabel>Inspections</SectionLabel>
          {inspections.length === 0 ? (
            <p className="text-[13px] text-stone-600">None logged for this job yet.</p>
          ) : (
            <div className="space-y-1.5">
              {inspections.map((insp) => (
                <div key={insp.id} className="rounded-xl border border-white/[0.06] px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13px] text-stone-200">
                      {insp.name}
                      {insp.is_final && <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-stone-500" style={MONO}>Final</span>}
                    </p>
                    {insp.status === "passed" ? (
                      <Pill tone="emerald">Passed{insp.completed_at ? ` ${fmtShortDate(insp.completed_at.slice(0, 10))}` : ""}</Pill>
                    ) : insp.status === "failed" ? (
                      <Pill tone="red">Failed</Pill>
                    ) : (
                      <Pill tone="muted">Pending</Pill>
                    )}
                  </div>
                  {insp.notes && <p className="mt-1 text-[12px] leading-relaxed text-stone-500">{insp.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* dates */}
      {phases.length > 0 && (
        <section>
          <SectionLabel>Your dates on this job</SectionLabel>
          <div className="space-y-1.5">
            {phases.map((p) => (
              <div key={p.id} className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] text-stone-200">{p.name}</p>
                <p className="shrink-0 text-[12px] text-stone-500" style={MONO}>
                  {fmtDate(p.start_date)}
                  {p.end_date && p.end_date !== p.start_date ? ` – ${fmtShortDate(p.end_date)}` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
