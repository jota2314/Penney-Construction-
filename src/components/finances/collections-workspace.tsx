import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { total, type CollectionRow } from "@/lib/finance/workspace-model";
import type { CollectionPace } from "@/lib/finance/collection-pace";
import { SendInvoiceButton } from "@/components/invoices/send-invoice-button";

/**
 * Collections, the simple version (Jorge 10/28: "way too complicated, I can't
 * see the data and the invoices"). Three numbers, then one list of who owes
 * what, oldest first. Each invoice opens its PDF and can be reminded in place.
 * Invoices that already have a matching check logged sit in their own box so
 * nobody chases a client who has paid. Amounts are cents.
 */

const dollars = (n: number) =>
  (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const exact = (n: number) =>
  (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const shortDay = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const waited = (r: CollectionRow) =>
  !r.sent
    ? "Send date missing"
    : `${shortDay(r.sent)} · ${r.daysWaiting === 0 ? "today" : r.daysWaiting === 1 ? "1 day" : `${r.daysWaiting} days`}`;
const pdfHref = (id: string) => `/api/generate-client-invoice?invoiceId=${id}`;
const jobHref = (projectId: string) => `/projects/${projectId}?tab=finances#fin-invoices`;

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
      <p className="text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">{label}</p>
      <p className="mt-1.5 text-base font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere] sm:mt-2 sm:text-3xl">{value}</p>
      <p className="mt-1 text-[11px] leading-tight text-muted-foreground sm:text-xs">{note}</p>
    </div>
  );
}

function PdfButton({ id }: { id: string }) {
  return (
    <a
      href={pdfHref(id)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <FileText className="h-3 w-3" />
      PDF
    </a>
  );
}

function InvoiceTitle({ row }: { row: CollectionRow }) {
  return (
    <a href={pdfHref(row.id)} target="_blank" rel="noopener noreferrer" className="group block min-w-0 flex-1">
      <p className="truncate font-medium group-hover:underline group-hover:underline-offset-4">{row.projectName}</p>
      <p className="truncate text-xs text-muted-foreground">
        #{row.number} · {row.title}
      </p>
    </a>
  );
}

export function CollectionsWorkspace({ rows, pace }: { rows: CollectionRow[]; pace: CollectionPace }) {
  const open = rows
    .filter((r) => !r.issue && !r.loggedPayment)
    .sort((a, b) => b.daysWaiting - a.daysWaiting || a.projectName.localeCompare(b.projectName));
  const logged = rows.filter((r) => !r.issue && r.loggedPayment);
  const flagged = rows.filter((r) => r.issue);
  const { thisWeek, lastWeek, month } = pace;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat
          label="Still owed"
          value={dollars(total(open, (r) => r.balance))}
          note={`${open.length} ${open.length === 1 ? "invoice" : "invoices"}`}
        />
        <Stat label="Came in this week" value={dollars(thisWeek.collected)} note={`Last week ${dollars(lastWeek.collected)}`} />
        <Stat
          label={`Came in ${month.label}`}
          value={dollars(month.collected)}
          note={
            month.goal
              ? `${Math.round((month.collected / month.goal) * 100)}% of ${dollars(month.goal)}`
              : `No goal set for ${month.label}`
          }
        />
      </div>

      <section aria-label="Open invoices" className="overflow-hidden rounded-xl border">
        <div className="flex items-baseline justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
          <h2 className="text-sm font-semibold">Open invoices</h2>
          <p className="text-xs text-muted-foreground">
            Oldest first<span className="hidden sm:inline"> · click one to open the PDF</span>
          </p>
        </div>
        {open.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing open. Every sent invoice is paid.</p>
        ) : (
          <ul className="divide-y">
            {open.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-6">
                <InvoiceTitle row={r} />
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <div className="text-left sm:w-40 sm:text-right">
                    <p className="font-semibold tabular-nums">{exact(r.balance)}</p>
                    <p
                      className={`text-xs ${
                        r.daysWaiting > 30 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"
                      }`}
                    >
                      {waited(r)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <PdfButton id={r.id} />
                    <SendInvoiceButton invoiceId={r.id} invoiceNumber={r.number} reminder />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {logged.length > 0 && (
        <section aria-label="Check logged, not linked yet" className="overflow-hidden rounded-xl border border-amber-500/40">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Check logged, not linked yet · {exact(total(logged, (r) => r.balance))}
            </h2>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
              Not in the total above. Link the check on the job to close the invoice.
            </p>
          </div>
          <ul className="divide-y">
            {logged.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-6">
                <InvoiceTitle row={r} />
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <div className="text-left sm:w-40 sm:text-right">
                    <p className="font-semibold tabular-nums">{exact(r.balance)}</p>
                    <p className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.loggedPayment!.reference ? `Check ${r.loggedPayment!.reference}` : "Payment"} ·{" "}
                      {shortDay(r.loggedPayment!.date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <PdfButton id={r.id} />
                    <Link
                      href={jobHref(r.projectId)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors hover:bg-muted"
                    >
                      Link check
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {flagged.length > 0 && (
        <section aria-label="Needs a look" className="overflow-hidden rounded-xl border">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Needs a look</h2>
            <p className="text-xs text-muted-foreground">Payments and invoice amounts disagree. Not in the total above.</p>
          </div>
          <ul className="divide-y">
            {flagged.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-6">
                <InvoiceTitle row={r} />
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <div className="text-left sm:w-40 sm:text-right">
                    <p className="font-semibold tabular-nums">{exact(r.balance)}</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">{r.issue}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <PdfButton id={r.id} />
                    <Link
                      href={jobHref(r.projectId)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors hover:bg-muted"
                    >
                      Open job
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
