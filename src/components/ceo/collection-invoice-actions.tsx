"use client";

import { FileText, ExternalLink } from "lucide-react";
import { ClientInvoiceDialog } from "@/components/invoices/client-invoice-dialog";
import type { CollectionInvoiceProject } from "@/lib/finance/collection-invoices";
import { formatMoney } from "@/lib/money";

export function CollectionInvoiceActions({ project }: { project?: CollectionInvoiceProject }) {
  if (!project) return <p className="mt-2 text-xs text-muted-foreground">Invoice access unavailable. Refresh to try again.</p>;
  const drafts = project.invoices.filter(invoice => invoice.status === "draft").length;
  return (
    <details className="group/invoices mt-3 rounded-lg border bg-background/50">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <FileText className="h-3.5 w-3.5 shrink-0" />View / create invoices ({project.invoices.length})
      </summary>
      <div className="space-y-3 border-t p-3">
        <p className="text-xs font-medium">{project.name}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">Current Penney invoice records for this job. Plan targets above are from the dated email.</p>
        {project.invoices.length ? <ul className="max-h-64 space-y-2 overflow-y-auto">
          {project.invoices.map(invoice => <li key={invoice.id} className="rounded-lg border p-2 text-xs">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">Invoice #{invoice.invoice_number}</span><span className="font-semibold tabular-nums">{formatMoney(invoice.amount)}</span></div>
            <p className="mt-1 break-words">{invoice.title}</p>
            <p className="mt-1 text-[10px] text-muted-foreground"><span className="capitalize">{invoice.status}</span>{invoice.due_date ? ` · Due ${invoice.due_date}` : ""}</p>
            <a href={`/api/generate-client-invoice?invoiceId=${invoice.id}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium underline underline-offset-4">View invoice PDF <ExternalLink className="h-3 w-3" /></a>
          </li>)}
        </ul> : <p className="text-xs text-muted-foreground">No client invoices recorded in Penney for this job.</p>}
        {drafts > 0 && <p className="text-[11px] text-amber-700 dark:text-amber-400">{drafts} existing draft{drafts === 1 ? "" : "s"} — review before creating another invoice.</p>}
        <ClientInvoiceDialog projectId={project.id} projectName={project.name} />
        <a href={`/projects/${project.id}?tab=finances#fin-invoices`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-4">Manage invoices in project <ExternalLink className="h-3 w-3" /></a>
      </div>
    </details>
  );
}
