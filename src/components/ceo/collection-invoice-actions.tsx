"use client";

import { FileText, ExternalLink } from "lucide-react";
import { ClientInvoiceDialog } from "@/components/invoices/client-invoice-dialog";
import type { CollectionInvoice, CollectionInvoiceProject } from "@/lib/finance/collection-invoices";
import { canReviewInvoiceDraft, groupCollectionInvoices } from "@/lib/finance/collection-invoice-workflow";
import { formatMoney } from "@/lib/money";

export function CollectionInvoiceActions({ project, embedded = false }: { project?: CollectionInvoiceProject; embedded?: boolean }) {
  if (!project) return <p className="mt-2 text-xs text-muted-foreground">Invoice access unavailable. Refresh to try again.</p>;
  const { issued, scheduled, drafts, history } = groupCollectionInvoices(project.invoices);
  const content = (
      <div className={embedded ? "space-y-4" : "space-y-4 border-t p-3"}>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="inline-flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-muted-foreground" />Existing invoices</h4><span className="text-[10px] text-muted-foreground">App records</span></div>
          <p className="mt-1 break-words text-[11px] text-muted-foreground">{project.name}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]"><span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-800 dark:text-emerald-400">{issued.length} issued</span><span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">{scheduled.length + drafts.length} drafts · not sent</span></div>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">Review an existing invoice below. Confirm the milestone before using the project’s send workflow. Drafts are not issued receivables.</p>
        <InvoiceGroup title="Issued · review collection status" invoices={issued} project={project} />
        <InvoiceGroup title="Scheduled drafts · not sent" invoices={scheduled} project={project} />
        <InvoiceGroup title="Other drafts · not sent" invoices={drafts} project={project} />
        {!issued.length && !scheduled.length && !drafts.length && <p className="text-xs text-muted-foreground">No issued or draft client invoices recorded for this job.</p>}
        {history.length > 0 && <details className="rounded-lg border p-2"><summary className="cursor-pointer text-xs text-muted-foreground">Paid / void history ({history.length})</summary><InvoiceGroup invoices={history} project={project} /></details>}
        <a href={`/projects/${project.id}?tab=finances#fin-invoices`} target="_blank" rel="noopener noreferrer" className="flex min-h-10 items-center justify-center gap-2 rounded-lg border bg-background px-3 py-2 text-center text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open project to send / manage <ExternalLink className="h-3 w-3 shrink-0" /></a>
        <details className="border-t pt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">Need an additional invoice?</summary>
          <p className="my-2 text-[11px] leading-relaxed text-muted-foreground">Use this for a separate charge that is not already covered by an existing invoice or scheduled draft.</p>
          <ClientInvoiceDialog projectId={project.id} projectName={project.name} triggerLabel="Create additional invoice" />
        </details>
      </div>
  );
  if (embedded) return content;
  return <details className="group/invoices mt-3 rounded-lg border bg-background/50"><summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400"><FileText className="h-3.5 w-3.5 shrink-0" />Review invoices · {issued.length} issued · {scheduled.length + drafts.length} drafts</summary>{content}</details>;
}

function InvoiceGroup({ title, invoices, project }: { title?: string; invoices: CollectionInvoice[]; project: CollectionInvoiceProject }) {
  if (!invoices.length) return null;
  return <div className="space-y-2">
    {title && <h4 className="text-[11px] font-semibold">{title} ({invoices.length})</h4>}
    <ul className="space-y-2">{invoices.map(invoice => <li key={invoice.id} className="rounded-xl border bg-background/60 p-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">Invoice #{invoice.invoice_number}</span><span className="font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMoney(invoice.amount)}</span></div>
      <p className="mt-1.5 break-words leading-relaxed">{invoice.title}</p>
      <p className="mt-2 text-[10px] text-muted-foreground"><span className="rounded bg-muted px-1.5 py-0.5 capitalize">{invoice.status}</span>{invoice.due_date ? ` · Due ${invoice.due_date}` : ""}</p>
      {invoice.status === "draft" && !invoice.sent_to_client_at && invoice.milestone && <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Contract milestone: {invoice.milestone.label}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canReviewInvoiceDraft(invoice) && <ClientInvoiceDialog projectId={project.id} projectName={project.name} invoice={invoice} triggerLabel="Review draft" />}
        <a href={`/api/generate-client-invoice?invoiceId=${invoice.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 font-medium underline underline-offset-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View PDF <ExternalLink className="h-3 w-3" /></a>
      </div>
    </li>)}</ul>
  </div>;
}
