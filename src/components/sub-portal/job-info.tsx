"use client";

import { useState } from "react";
import { Empty, MoneySummary, TimelineList, TimelineRow, type TimelineChip } from "@/components/portal-kit";
import { roundCents } from "@/lib/money";
import { fmtDate, fmtMoney, fmtShort } from "@/lib/portal-kit/format";
import { SUB_QUOTE_STAGE_LABEL } from "@/lib/sub-portal/statuses";
import type {
  SubAgreedAmount,
  SubAgreementSummary,
  SubDatePhase,
  SubInvoiceGroup,
  SubJobPayload,
  SubQuote,
  SubSelection,
} from "@/lib/sub-portal/payload";
import { SendInvoiceSheet } from "./send-invoice-sheet";
import { SignSheet } from "./sign-sheet";

/**
 * A job's Job info tab (plan §2.3 S3): his work order(s) with Review & sign,
 * what was agreed, the scope for his trade, his dates (read-only; he answers
 * them on the Dates tab), his quotes, the homeowner's selections, and his
 * billing on this job. All of it is his own: the server never sends client
 * prices, allowances or other subs' numbers. Money is always to the cent.
 */

const SECTION_TITLE = "px-1 pb-2 pt-1 text-[18px] font-extrabold";

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-bold text-white" style={{ background: color }}>
      {label}
    </span>
  );
}

const GREEN = "#2F6B4F";
const RED = "#8A2D10";
const AMBER = "#7A5A1E";
const INK = "#252D2B";
const GREY = "#5F6763";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : s);

export function JobInfo({
  data,
  preview,
  agreementsEnabled,
  jobsForInvoice,
  onChanged,
}: {
  data: SubJobPayload;
  preview: boolean;
  /** SubHomePayload.flags.agreements_enabled. Left out = trust agreement.can_sign alone. */
  agreementsEnabled?: boolean;
  /** Passed only when invoices are live (flags.bills_enabled): shows "Send an invoice". */
  jobsForInvoice?: { project_id: string; name: string }[];
  onChanged: () => void;
}) {
  const [signing, setSigning] = useState<string | null>(null);
  const [invoicing, setInvoicing] = useState(false);
  // The job on screen is always billable from its own screen, even when it
  // isn't on his live list (a closed job he's still owed on). Never let the
  // sheet open on some other job.
  const invoiceJobs = jobsForInvoice
    ? jobsForInvoice.some((j) => j.project_id === data.job.project_id)
      ? jobsForInvoice
      : [{ project_id: data.job.project_id, name: data.job.name }, ...jobsForInvoice]
    : undefined;
  const canSendInvoice = !!invoiceJobs;

  return (
    <div className="space-y-6">
      {data.agreements.length > 0 && (
        <section>
          <h3 className={SECTION_TITLE}>Your work order{data.agreements.length === 1 ? "" : "s"}</h3>
          <ul className="space-y-3">
            {data.agreements.map((a) => (
              <AgreementCard
                key={a.id}
                agreement={a}
                canSign={a.can_sign && !preview && agreementsEnabled !== false}
                onSign={() => setSigning(a.id)}
              />
            ))}
          </ul>
        </section>
      )}

      <AgreedLine agreed={data.agreed} />

      <section>
        <h3 className={SECTION_TITLE}>Scope for your trade</h3>
        {data.scope.length === 0 ? (
          <Empty>No scope written up for your trade yet. Call Penney with questions.</Empty>
        ) : (
          <ul className="card divide-y divide-[var(--line)]">
            {data.scope.map((s, i) => (
              <li key={`${s.trade}-${i}`} className="p-4">
                <p className="label">{cap(s.trade)}</p>
                <p className="text-[17px] font-bold leading-snug">{s.description}</p>
                {s.scope && <p className="mt-1 whitespace-pre-line text-[16px] text-[var(--muted)]">{s.scope}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className={SECTION_TITLE}>Your dates on this job</h3>
        {data.dates.length === 0 ? (
          <Empty>No dates for you on this job yet.</Empty>
        ) : (
          <>
            <TimelineList>
              {data.dates.map((p) => (
                <DateRow key={p.id} phase={p} />
              ))}
            </TimelineList>
            <p className="mt-2 px-1 text-[15px] text-[var(--muted)]">Confirm or change dates on the Dates tab.</p>
          </>
        )}
      </section>

      {data.quotes.length > 0 && (
        <section>
          <h3 className={SECTION_TITLE}>Your prices on this job</h3>
          <ul className="card divide-y divide-[var(--line)]">
            {data.quotes.map((q) => (
              <QuoteRow key={`${q.source}-${q.id}`} quote={q} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className={SECTION_TITLE}>Fixtures & selections</h3>
        {data.selections.length === 0 ? (
          <Empty>No selections posted for this job yet.</Empty>
        ) : (
          <ul className="card divide-y divide-[var(--line)]">
            {data.selections.map((s) => (
              <SelectionRow key={s.id} selection={s} />
            ))}
          </ul>
        )}
      </section>

      {data.billing && (
        <section>
          <h3 className={SECTION_TITLE}>Your billing on this job</h3>
          <div className="space-y-3">
            <MoneySummary
              label="Open on this job"
              amount={data.billing.summary.open}
              stats={[
                { label: "Billed", amount: data.billing.summary.billed },
                { label: "Paid", amount: data.billing.summary.paid, tone: "paid" },
              ]}
            />
            {data.billing.invoices.length === 0 ? (
              <Empty>No invoices on this job yet.</Empty>
            ) : (
              <ul className="card divide-y divide-[var(--line)]">
                {data.billing.invoices.map((inv) => (
                  <InvoiceRow key={inv.key} invoice={inv} projectId={data.job.project_id} />
                ))}
              </ul>
            )}
            {canSendInvoice && (
              <button type="button" onClick={() => setInvoicing(true)} disabled={preview} className="btn btn-primary btn-lg btn-block">
                Send an invoice for this job
              </button>
            )}
          </div>
        </section>
      )}

      {signing && (
        <SignSheet
          agreementId={signing}
          preview={preview}
          onClose={() => setSigning(null)}
          onChanged={onChanged}
          onSigned={() => {
            setSigning(null);
            onChanged();
          }}
        />
      )}
      {invoicing && invoiceJobs && (
        <SendInvoiceSheet
          jobs={invoiceJobs}
          defaultProjectId={data.job.project_id}
          onClose={() => setInvoicing(false)}
          onSent={() => {
            setInvoicing(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────── work orders

function agreementPill(a: SubAgreementSummary): { label: string; color: string } {
  switch (a.status) {
    case "sent":
    case "viewed":
      return { label: "Ready to sign", color: AMBER };
    case "signed":
      return a.signed_on_paper
        ? { label: "Signed on paper", color: GREEN }
        : { label: a.sub_signed_at ? `Signed ${fmtShort(a.sub_signed_at)}` : "Signed", color: GREEN };
    case "void":
      return { label: "Void", color: RED };
    case "superseded":
      return { label: "Replaced", color: GREY };
    default:
      return { label: "Draft", color: GREY };
  }
}

/** "Lump sum $4,500.00" · "$65.00 per hour, not to exceed $3,000.00" · "$8.50 per sq ft". */
function priceLine(a: SubAgreementSummary): string | null {
  const nte = a.not_to_exceed != null ? `, not to exceed ${fmtMoney(a.not_to_exceed)}` : "";
  switch (a.price_basis) {
    case "lump_sum":
      return a.price != null ? `Lump sum ${fmtMoney(a.price)}` : null;
    case "unit":
      return a.unit_rate != null ? `${fmtMoney(a.unit_rate)} per ${a.unit_label || "unit"}${nte}` : null;
    case "time_and_material":
      return a.unit_rate != null ? `Time and material: ${fmtMoney(a.unit_rate)} per ${a.unit_label || "hour"}${nte}` : null;
    default:
      return a.price != null ? fmtMoney(a.price) : null;
  }
}

function AgreementCard({ agreement: a, canSign, onSign }: { agreement: SubAgreementSummary; canSign: boolean; onSign: () => void }) {
  const pill = agreementPill(a);
  const price = priceLine(a);
  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] font-bold leading-snug">{a.number}</p>
          <p className="text-[16px] text-[var(--muted)]">
            {a.title}
            {a.parent_number ? ` · changes ${a.parent_number}` : ""}
          </p>
        </div>
        <Pill label={pill.label} color={pill.color} />
      </div>
      {a.scope_text && <p className="mt-2 whitespace-pre-line text-[16px]">{a.scope_text}</p>}
      {price && <p className="mt-2 text-[17px] font-extrabold">{price}</p>}
      {a.status === "void" && a.void_reason && <p className="mt-2 text-[15px] text-[var(--muted)]">Why: {a.void_reason}</p>}
      <div className="mt-3 flex flex-col gap-3">
        {canSign && (
          <button type="button" onClick={onSign} className="btn btn-primary btn-lg btn-block">
            Review & sign
          </button>
        )}
        <a href={a.pdf_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-block">
          Open the PDF ›
        </a>
      </div>
    </li>
  );
}

function AgreedLine({ agreed }: { agreed: SubAgreedAmount }) {
  if (agreed.basis === "none" || agreed.amount == null) {
    return (
      <div className="card p-4">
        <p className="label">Agreed for your work</p>
        <p className="text-[16px]">No agreed price on file yet.</p>
      </div>
    );
  }
  const label = agreed.basis === "quoted" ? "Quoted" : agreed.is_not_to_exceed ? "Agreed, not to exceed" : "Agreed for your work";
  const source =
    agreed.basis === "work_order"
      ? agreed.agreement_number
        ? `Signed work order ${agreed.agreement_number}`
        : "Signed work order"
      : agreed.basis === "awarded_lines"
        ? "Your awarded work"
        : agreed.basis === "quoted"
          ? "From your accepted price"
          : null;
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className="text-[24px] font-extrabold leading-tight">{fmtMoney(agreed.amount)}</p>
      {source && <p className="text-[15px] text-[var(--muted)]">{source}</p>}
    </div>
  );
}

// ───────────────────────────────────────── dates, quotes, selections

function dateChip(p: SubDatePhase): TimelineChip {
  if (p.status === "completed") return "done";
  if (p.sub_response === "declined") return "declined";
  if (p.needs_answer) return "answer";
  if (p.status === "in_progress") return "now";
  return p.firm ? "confirmed" : "penciled";
}

function DateRow({ phase: p }: { phase: SubDatePhase }) {
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
    >
      {p.sub_response_note && <p className="mt-1 text-[15px] text-[var(--muted)]">You said: {p.sub_response_note}</p>}
    </TimelineRow>
  );
}

const STAGE_COLOR: Record<SubQuote["stage"], string> = {
  awarded: GREEN,
  under_review: INK,
  not_selected: GREY,
  price_needed: AMBER,
};

function QuoteRow({ quote: q }: { quote: SubQuote }) {
  return (
    <li className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] font-bold leading-snug">{q.title}</p>
          <p className="text-[15px] text-[var(--muted)]">
            {[q.trade ? cap(q.trade) : null, q.date ? fmtDate(q.date, "") : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Pill label={SUB_QUOTE_STAGE_LABEL[q.stage]} color={STAGE_COLOR[q.stage]} />
      </div>
      {q.amount != null && <p className="mt-2 text-[17px] font-extrabold">{fmtMoney(q.amount)}</p>}
      {q.scope && <p className="clamp3 mt-1 whitespace-pre-line text-[15px] text-[var(--muted)]">{q.scope}</p>}
      {q.pdf_url && (
        <a href={q.pdf_url} target="_blank" rel="noreferrer" className="btn btn-ghost mt-3">
          Open your PDF ›
        </a>
      )}
    </li>
  );
}

const SELECTION_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Not picked yet", color: GREY },
  selected: { label: "Picked", color: GREEN },
  ordered: { label: "Ordered", color: INK },
  delivered: { label: "Delivered", color: GREEN },
  installed: { label: "Installed", color: GREEN },
};

function SelectionRow({ selection: s }: { selection: SubSelection }) {
  const pill = SELECTION_STATUS[s.status] ?? { label: cap(s.status || "pending"), color: GREY };
  return (
    <li className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label">{s.category}</p>
          <p className="text-[17px] font-bold leading-snug">{s.selected_value || s.description || "To be picked"}</p>
          {s.selected_value && s.description && <p className="text-[15px] text-[var(--muted)]">{s.description}</p>}
        </div>
        <Pill label={pill.label} color={pill.color} />
      </div>
    </li>
  );
}

// ───────────────────────────────────────── billing

function invoicePill(inv: SubInvoiceGroup): { label: string; color: string } {
  switch (inv.status) {
    case "paid":
      return { label: inv.paid_date ? `Paid ${fmtShort(inv.paid_date)}` : "Paid", color: GREEN };
    case "sent_back":
      return { label: "Sent back", color: RED };
    case "with_penney":
      return { label: "With Penney", color: GREY };
    default:
      return { label: "Owed", color: AMBER };
  }
}

function InvoiceRow({ invoice: inv, projectId }: { invoice: SubInvoiceGroup; projectId: string }) {
  const pill = invoicePill(inv);
  // A bill split across jobs: say how much of it is this job's.
  const here = inv.allocations.filter((a) => a.project_id === projectId);
  const split = inv.allocations.length > 1 && here.length > 0;
  const hereAmount = here.reduce((s, a) => s + a.amount, 0);
  return (
    <li className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] font-bold leading-snug">{inv.invoice_number || "No invoice #"}</p>
          <p className="text-[15px] text-[var(--muted)]">{fmtDate(inv.date, "No date")}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[17px] font-extrabold">{fmtMoney(inv.amount)}</p>
          <Pill label={pill.label} color={pill.color} />
        </div>
      </div>
      {split && <p className="mt-1 text-[15px] text-[var(--muted)]">{fmtMoney(roundCents(hereAmount))} of it is this job</p>}
      {inv.status === "owed" && inv.paid > 0 && <p className="mt-1 text-[15px] text-[var(--muted)]">{fmtMoney(inv.open)} still open</p>}
      {inv.status === "sent_back" && inv.returned_reason && (
        <p className="mt-1 text-[15px]" style={{ color: RED }}>
          Sent back: {inv.returned_reason}
        </p>
      )}
    </li>
  );
}
