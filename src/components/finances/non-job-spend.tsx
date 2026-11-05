"use client";

import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getNonJobTransactionHistory,
  reopenNonJobTransaction,
  resolveNonJobTransaction,
  type NonJobReason,
  type NonJobTransaction,
  type NonJobTransactionHistory,
} from "@/lib/actions/non-job-spend";

const REASON_LABELS: Record<NonJobReason, string> = {
  owner_draw: "Owner Draw",
  card_payment_transfer: "Credit Card Payment/Transfer",
};

const money = (amount: number | null) => amount === null ? "Amount unavailable" :
  amount.toLocaleString("en-US", { style: "currency", currency: "USD" });

function dateTime(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

export function ResolveNonJobEditor({ invoiceId, vendor, amount, expectedUpdatedAt, onCancel, onResolved }: {
  invoiceId: string;
  vendor: string;
  amount: number | null;
  expectedUpdatedAt: string;
  onCancel: () => void;
  onResolved: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState<NonJobReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);

  function confirm() {
    if (!reason || submitting.current) return;
    submitting.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await resolveNonJobTransaction({
          invoiceId, reason, note: note.trim() || undefined, expectedUpdatedAt,
        });
        if (result.error) { setError(result.error); submitting.current = false; }
        else onResolved();
      } catch {
        submitting.current = false;
        setError("Could not confirm the result. Refresh this transaction before trying again.");
      }
    });
  }

  return <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-3">
    <div>
      <h3 id={`${id}-title`} className="text-sm font-semibold">Resolve as non-job transaction</h3>
      <p className="mt-1 text-xs font-medium">{vendor} · {money(amount)}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Choose the reason for this saved transaction. Confirming removes its job and budget-line assignment
        and excludes it from job costs and operating costs. The transaction, amount, payment records,
        attachments and change history are retained. You can return it to review with a note.
      </p>
    </div>
    <label className="flex flex-col gap-1 text-xs" htmlFor={`${id}-reason`}>
      Reason <span className="sr-only">(required)</span>
      <select id={`${id}-reason`} value={reason} onChange={event => setReason(event.target.value as NonJobReason | "")}
        disabled={pending} className="min-h-9 rounded-lg border bg-background px-2.5" required>
        <option value="" disabled>Choose a reason…</option>
        <option value="owner_draw">Owner Draw</option>
        <option value="card_payment_transfer">Credit Card Payment/Transfer</option>
      </select>
    </label>
    <label className="flex flex-col gap-1 text-xs" htmlFor={`${id}-note`}>
      Factual note (optional)
      <textarea id={`${id}-note`} value={note} onChange={event => setNote(event.target.value)} disabled={pending}
        rows={2} maxLength={2000} placeholder="Add context or a source for this classification."
        className="rounded-lg border bg-background px-2.5 py-2" />
    </label>
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={confirm} disabled={pending || !reason}
        className="min-h-9 rounded-lg bg-sky-700 px-3 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50">
        {pending ? "Resolving…" : "Confirm non-job transaction"}
      </button>
      <button type="button" onClick={onCancel} disabled={pending} className="min-h-9 rounded-lg border px-3 text-xs disabled:opacity-50">Cancel</button>
    </div>
  </section>;
}

export function NonJobHistory({ invoiceId }: { invoiceId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<NonJobTransactionHistory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setError(null);
    startTransition(async () => {
      try { setEntries(await getNonJobTransactionHistory(invoiceId)); }
      catch { setEntries(null); setError("History could not load. Close and reopen it to try again."); }
    });
  }

  return <div>
    <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} className="text-xs underline underline-offset-2">
      {open ? "Hide non-job history" : "View non-job history"}
    </button>
    {open && <div id={id} className="mt-2 rounded-lg border p-3 text-xs">
      {pending ? <p role="status">Loading history…</p> : error ? <p role="alert" className="text-red-400">{error}</p> : entries?.length ?
        <ol className="space-y-3">{entries.map(entry => <li key={entry.id}>
          <p className="font-medium">{entry.action === "resolved" ? "Resolved as non-job" : "Returned to review"}
            {entry.reason ? ` · ${REASON_LABELS[entry.reason]}` : ""}</p>
          <p className="mt-0.5 text-muted-foreground">{entry.actor_name || "Team member"} · {dateTime(entry.created_at)}</p>
          {entry.note && <p className="mt-1 whitespace-pre-wrap break-words">{entry.note}</p>}
        </li>)}</ol> : <p className="text-muted-foreground">No non-job classification changes recorded.</p>}
    </div>}
  </div>;
}

function ResolvedNonJobRow({ row }: { row: NonJobTransaction }) {
  const router = useRouter();
  const id = useId();
  const [reopening, setReopening] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);

  function reopen() {
    if (!note.trim() || submitting.current) return;
    submitting.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await reopenNonJobTransaction({ invoiceId: row.id, note: note.trim(), expectedUpdatedAt: row.updated_at });
        if (result.error) { setError(result.error); submitting.current = false; }
        else { setReopening(false); router.refresh(); }
      } catch {
        submitting.current = false;
        setError("Could not confirm the result. Refresh this transaction before trying again.");
      }
    });
  }

  return <article id={`non-job-${row.id}`} className="space-y-3 border-t p-4 scroll-mt-4">
    <div className="flex flex-wrap justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold break-words">{row.vendor_name || "Unnamed transaction"}{row.invoice_number ? ` · #${row.invoice_number}` : ""}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{row.invoice_date || "No transaction date"}{row.payment_method ? ` · ${row.payment_method.replaceAll("_", " ")}` : ""}</p>
      </div>
      <p className="text-sm font-semibold tabular-nums">{money(row.amount)}</p>
    </div>
    <div className="text-xs">
      <p className="font-medium text-sky-400">{REASON_LABELS[row.non_job_reason]}</p>
      <p className="mt-1 text-muted-foreground">Resolved by {row.non_job_resolved_by_name || "team member"} · {dateTime(row.non_job_resolved_at)}</p>
      {row.non_job_note && <p className="mt-2 whitespace-pre-wrap break-words">{row.non_job_note}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-4">
      <NonJobHistory invoiceId={row.id} />
      <Link href={`/spent/${row.id}`} className="text-xs underline underline-offset-2">Open transaction</Link>
      {!reopening && <button type="button" onClick={() => setReopening(true)} className="min-h-9 rounded-lg border px-3 text-xs">Return to review</button>}
    </div>
    {reopening && <div className="space-y-2 rounded-lg border bg-background/50 p-3">
      <p className="text-xs text-muted-foreground">This removes the non-job classification and returns the transaction to Sort out spending for a new job and budget-line assignment. Its history is retained.</p>
      <label htmlFor={`${id}-reopen`} className="flex flex-col gap-1 text-xs">
        Reason for returning to review (required)
        <textarea id={`${id}-reopen`} value={note} onChange={event => setNote(event.target.value)} rows={2} required maxLength={2000}
          disabled={pending} className="rounded-lg border bg-background px-2.5 py-2" />
      </label>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={reopen} disabled={pending || !note.trim()}
          className="min-h-9 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
          {pending ? "Returning…" : "Confirm return to review"}
        </button>
        <button type="button" onClick={() => { setReopening(false); setError(null); setNote(""); }} disabled={pending}
          className="min-h-9 rounded-lg border px-3 text-xs disabled:opacity-50">Cancel</button>
      </div>
    </div>}
  </article>;
}

export function NonJobTransactions({ rows }: { rows: NonJobTransaction[] }) {
  const [filter, setFilter] = useState("");
  const visible = rows.filter(row => [row.vendor_name, row.invoice_number, row.non_job_note, REASON_LABELS[row.non_job_reason]]
    .some(value => value?.toLowerCase().includes(filter.trim().toLowerCase())));

  return <section className="overflow-hidden rounded-xl border bg-card" aria-label="Resolved non-job transactions">
    <div className="space-y-2 p-4">
      <h2 className="text-sm font-semibold">Resolved non-job transactions <span className="text-muted-foreground tabular-nums">({rows.length})</span></h2>
      <p className="text-xs leading-relaxed text-muted-foreground">Owner draws and credit card payments/transfers stay here with their history. These amounts are excluded from job costs and operating costs.</p>
      {rows.length > 0 && <input type="search" value={filter} onChange={event => setFilter(event.target.value)} aria-label="Search resolved non-job transactions"
        placeholder="Search vendor, reason or note…" className="min-h-9 w-full rounded-lg border bg-background px-3 text-xs sm:max-w-md" />}
    </div>
    {visible.length ? visible.map(row => <ResolvedNonJobRow key={`${row.id}-${row.updated_at}`} row={row} />) :
      <p className="border-t p-4 text-xs text-muted-foreground">{rows.length ? "No transactions match this search." : "No transactions have been resolved as non-job."}</p>}
  </section>;
}
