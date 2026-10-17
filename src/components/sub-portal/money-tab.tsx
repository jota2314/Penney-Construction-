"use client";

import { useState } from "react";
import { Empty, MoneySummary, PAID_GREEN } from "@/components/portal-kit";
import { fmtMoney, fmtShort } from "@/lib/portal-kit/format";
import type {
  SubAgreedAmount,
  SubBillSubmissionSummary,
  SubInvoiceGroup,
  SubInvoiceStatus,
  SubMoneyByJob,
  SubMoneyPayload,
} from "@/lib/sub-portal/payload";
import type { OpenJobOptions } from "./sub-portal-view";

/**
 * Money: his own bills to Penney and nothing else, always to the cent.
 *
 *  - The summary: his work on open jobs, paid this year, owed to him, and
 *    "Sent, waiting for Penney" as a count kept apart from owed (owed counts
 *    only bills Penney has reviewed, so an upload doesn't read as money due).
 *  - Send an invoice, when portal bills are switched on (not in a preview).
 *  - Invoices, Open or All, one row per invoice number with its job splits
 *    underneath: "INV0325 · Oct 14 · $600.00" or "No invoice # · …".
 *  - By job: agreed · billed · paid · open. A tap opens that job's Job info.
 *
 * Every figure comes from the server (load-sub-portal-data.ts); nothing is
 * added up here except what's on screen.
 */

type Filter = "open" | "all";

const OPEN_STATUSES: readonly SubInvoiceStatus[] = ["owed", "with_penney", "sent_back"];

/** Solid pills, white text: With Penney / Owed / Paid Oct 15 / Sent back. */
const STATUS_PILL: Record<SubInvoiceStatus, { label: string; color: string }> = {
  with_penney: { label: "With Penney", color: "#5F6763" },
  owed: { label: "Owed", color: "#9E4E28" },
  paid: { label: "Paid", color: PAID_GREEN },
  sent_back: { label: "Sent back", color: "#8A2D10" },
};

export function MoneyTab({
  money,
  canSendInvoice,
  onSendInvoice,
  onOpenJob,
}: {
  money: SubMoneyPayload;
  /** Portal bills are on and this isn't a preview. */
  canSendInvoice: boolean;
  onSendInvoice: () => void;
  onOpenJob: (projectId: string, opts?: OpenJobOptions) => void;
}) {
  const openCount = money.invoices.filter((g) => OPEN_STATUSES.includes(g.status)).length;
  const [filter, setFilter] = useState<Filter>(openCount > 0 ? "open" : "all");
  const shown = filter === "open" ? money.invoices.filter((g) => OPEN_STATUSES.includes(g.status)) : money.invoices;

  const { summary } = money;
  const waiting = summary.waiting_count;

  // Biggest open balance first, then the most billed.
  const byJob = [...money.by_job].sort((a, b) => b.open - a.open || b.billed - a.billed);

  // A portal submission that isn't filed yet has no job splits; its row
  // still names the job he picked when he sent it.
  const submissionsById = new Map(money.submissions.map((s) => [s.id, s]));
  const submissionFor = (g: SubInvoiceGroup): SubBillSubmissionSummary | undefined => {
    if (g.source !== "submission") return undefined;
    if (g.key.startsWith("submission:")) return submissionsById.get(g.key.slice("submission:".length));
    return money.submissions.find(
      (s) => s.status !== "filed" && (s.sub_stated_number ?? s.ai_read?.invoice_number ?? null) === g.invoice_number,
    );
  };

  return (
    <>
      <MoneySummary
        label="Your work on open jobs"
        amount={summary.agreed_open_jobs}
        note={summary.agreed_open_jobs > 0 ? undefined : "No agreed prices on file yet."}
        stats={[
          { label: "Paid this year", amount: summary.paid_this_year, tone: "paid" },
          { label: "Owed to you", amount: summary.owed },
        ]}
      >
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
          <p className="label">Sent, waiting for Penney</p>
          <p className="shrink-0 text-[18px] font-extrabold">
            {waiting === 0 ? "None" : `${waiting} ${waiting === 1 ? "invoice" : "invoices"}`}
          </p>
        </div>
      </MoneySummary>

      {canSendInvoice && (
        <button type="button" onClick={onSendInvoice} className="btn btn-primary btn-lg btn-block">
          Send an invoice
        </button>
      )}

      {money.invoices.length === 0 ? (
        <Empty>Your invoices and payments show up here once Penney has them on file.</Empty>
      ) : (
        <section className="card px-4 pb-1 pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="label">Invoices</p>
            <div role="group" aria-label="Which invoices" className="flex gap-2">
              {(["open", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`min-h-[44px] rounded-full px-4 text-[15px] font-bold ${
                    filter === f ? "bg-[var(--ink)] text-white" : "border border-[var(--line)] text-[var(--muted)]"
                  }`}
                >
                  {f === "open" ? `Open${openCount > 0 ? ` (${openCount})` : ""}` : "All"}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="py-5 text-[16px] text-[var(--muted)]">Nothing open. You&apos;re paid up.</p>
          ) : (
            <ul className="mt-1 divide-y divide-[var(--line)]">
              {shown.map((g) => (
                <InvoiceRow key={g.key} group={g} submission={submissionFor(g)} />
              ))}
            </ul>
          )}
        </section>
      )}

      {byJob.length > 0 && (
        <section>
          <p className="label mb-2 px-1">By job</p>
          <ul className="card divide-y divide-[var(--line)] overflow-hidden">
            {byJob.map((j) => (
              <li key={j.project_id}>
                <JobMoneyRow job={j} onOpen={() => onOpenJob(j.project_id, { view: "info" })} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** One invoice: number · date · amount, its status, then which job(s) it was split to. */
function InvoiceRow({ group, submission }: { group: SubInvoiceGroup; submission?: SubBillSubmissionSummary }) {
  const pill = STATUS_PILL[group.status];
  const pillLabel = group.status === "paid" && group.paid_date ? `Paid ${fmtShort(group.paid_date)}` : pill.label;
  const title = `${group.invoice_number ?? "No invoice #"} · ${fmtShort(group.date, "No date")} · ${fmtMoney(group.amount)}`;

  // The words after the pill: what's still open on a part-paid invoice, or why it came back.
  let extra: string | null = null;
  if (group.status === "owed" && group.paid > 0) extra = `Open ${fmtMoney(group.open)} · paid ${fmtMoney(group.paid)}`;
  if (group.status === "sent_back") extra = group.returned_reason;

  const splits = group.allocations;
  return (
    <li className="py-3">
      <p className="text-[17px] font-bold leading-snug">{title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-bold text-white"
          style={{ background: pill.color }}
        >
          {pillLabel}
        </span>
        {extra && <span className="min-w-0 text-[15px] font-semibold">{extra}</span>}
      </div>
      {splits.length === 1 && (
        <p className="mt-1 truncate text-[15px] text-[var(--muted)]">
          {splits[0].project_name ?? "Job"}
          {splits[0].description ? ` · ${splits[0].description}` : ""}
        </p>
      )}
      {splits.length > 1 && (
        <ul className="mt-1 space-y-0.5">
          {splits.map((a) => (
            <li key={a.bill_id} className="flex items-baseline justify-between gap-3 text-[15px] text-[var(--muted)]">
              <span className="min-w-0 truncate">
                {a.project_name ?? "Job"}
                {a.description ? ` · ${a.description}` : ""}
              </span>
              <span className="shrink-0 font-semibold text-[var(--ink)]">{fmtMoney(a.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {splits.length === 0 && submission?.project_name && (
        <p className="mt-1 truncate text-[15px] text-[var(--muted)]">{submission.project_name} · sent from the app</p>
      )}
    </li>
  );
}

/** "Quoted" for a quote-only price, "Up to" for a T&M not-to-exceed, else "Agreed". */
function agreedLabel(agreed: SubAgreedAmount): string {
  if (agreed.basis === "quoted") return "Quoted";
  if (agreed.is_not_to_exceed) return "Up to";
  return "Agreed";
}

/** Job name, then agreed · billed · paid · open in a 2×2 grid that fits a 375px phone. */
function JobMoneyRow({ job, onOpen }: { job: SubMoneyByJob; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-bold leading-snug">{job.project_name}</span>
        <span className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
          <Figure label={agreedLabel(job.agreed)} amount={job.agreed.amount} />
          <Figure label="Billed" amount={job.billed} />
          <Figure label="Paid" amount={job.paid} paid />
          <Figure label="Open" amount={job.open} />
        </span>
      </span>
      <span aria-hidden className="shrink-0 text-[24px] font-bold leading-none text-[var(--muted)]">
        ›
      </span>
    </button>
  );
}

// Label over amount, so a six-figure amount never gets cut off at phone width.
function Figure({ label, amount, paid = false }: { label: string; amount: number | null; paid?: boolean }) {
  return (
    <span className="block min-w-0">
      <span className="block text-[13px] font-semibold text-[var(--muted)]">{label}</span>
      <span className="block text-[16px] font-bold" style={paid ? { color: PAID_GREEN } : undefined}>
        {fmtMoney(amount)}
      </span>
    </span>
  );
}
