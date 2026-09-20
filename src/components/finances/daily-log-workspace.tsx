import Link from "next/link";
import { BillWorkspace } from "@/components/finances/bill-workspace";
import { SpendOrganizer } from "@/components/finances/spend-organizer";
import { PaymentReviewList } from "@/components/projects/payment-review-list";
import { listCapturesForReview, listCaptureJobOptions } from "@/lib/actions/field-capture";
import { listPaymentsForReview, listPaymentJobOptions } from "@/lib/actions/deposit-capture";
import type { LogTransaction } from "@/lib/finance/daily-log";

export const WORKSPACE_TITLES: Record<string, string> = {
  expense: "Manage expense & payment",
  income: "Manage income payment",
  "review-expenses": "Review & assign expenses",
  "review-income": "Review income",
  bills: "Bills to pay",
};

export async function DailyLogWorkspace({ panel, id, month, records, failed }: {
  panel: string; id?: string; month: string; records: LogTransaction[]; failed: boolean;
}) {
  if (failed) return <p role="alert">The records couldn’t load. Close this panel and try again.</p>;
  const transaction = records.find(r => r.recordIds.includes(id ?? ""));
  if (id && !transaction) return <p>This transaction is unavailable. Close the panel and refresh your log.</p>;
  const href = (panel: string, id?: string) => `/finances/daily-log?month=${month}&panel=${panel}${id ? `&id=${id}` : ""}`;
  try {
    if (panel === "expense" && id && transaction?.kind === "expense") {
      // Resolve the server component here so a failed detail read stays inside
      // the workspace instead of taking the entire financial log down.
      const bill = await BillWorkspace({ id, embedded: true, month, paymentBlocked: transaction.review });
      return <>
        <Link href={href("review-expenses", id)} scroll={false} className="inline-block mb-3 rounded-lg border px-3 py-2 text-sm font-medium">Review, correct or split this expense</Link>
        {transaction.review && <p className="mb-3 text-sm text-amber-600">This transaction needs review. Resolve any duplicates before recording payment.</p>}
        {bill}
      </>;
    }
    if (panel === "income" || panel === "review-income") {
      if (panel === "income" && (!id || transaction?.kind !== "income")) return <p>Select an income payment from the log.</p>;
      const [payments, jobs] = await Promise.all([listPaymentsForReview(panel === "income" ? id : undefined), listPaymentJobOptions()]);
      return <><p className="mb-4 text-sm text-muted-foreground">Check the payment against its photo, correct its amount or job, then save and confirm here.</p><PaymentReviewList payments={payments} jobs={jobs} manage /></>;
    }
    if (panel === "review-expenses") {
      if (id && transaction?.kind !== "expense") return <p>Select an expense from the log.</p>;
      const [rows, jobs] = await Promise.all([listCapturesForReview(id ? transaction!.recordIds : undefined), listCaptureJobOptions()]);
      return <><p className="mb-4 text-sm text-muted-foreground">Check receipts, correct amounts, assign jobs and budget lines, or split costs using the existing expense review workflow.</p><SpendOrganizer rows={rows} jobs={jobs} /></>;
    }
    if (panel === "bills") {
      const bills = records.filter(r => r.kind === "expense" && r.status !== "Paid" && (r.amount === null || r.amount > 0));
      return <>
        <p className="mb-4 text-sm text-muted-foreground">Open bills across all dates. Open a bill to review it, approve it for payment, or record how it was paid. Recording a payment does not send money.</p>
        {!bills.length && <p>No open bills.</p>}
        <div className="divide-y rounded-lg border">{bills.map(r => <Link scroll={false} key={r.id} href={href("expense", r.recordIds[0])} className="flex flex-wrap justify-between gap-2 p-4 hover:bg-muted/40">
          <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.date || "Date needed"} · {r.status}{r.review ? " · Needs review" : ""}</div><div className="text-xs text-muted-foreground">{r.projects.map(p => p.label).join(", ") || "No job assigned"}</div></div>
          <div className="text-right tabular-nums"><div>{r.amount === null ? "Amount needs review" : r.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}</div><div className="text-xs text-muted-foreground">Full bill amount</div></div>
        </Link>)}</div>
      </>;
    }
    return <p>Select a transaction from the log.</p>;
  } catch {
    return <p role="alert">This workspace couldn’t load. Close it and try again. No changes were made.</p>;
  }
}
