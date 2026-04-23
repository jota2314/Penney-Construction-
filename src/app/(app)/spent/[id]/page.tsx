import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { ArrowUpRight, FileText, ExternalLink } from "lucide-react";

export const metadata: Metadata = { title: "Transaction | Penney Construction" };

const fmt = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n || 0);

export default async function SpentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;

  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("invoices")
    .select(`
      id, vendor_name, vendor_type, trade, invoice_number, invoice_date, due_date, terms,
      description, amount, paid_amount, payment_status, paid_date,
      attachment_storage_path, extracted_text, notes,
      project_id, estimate_line_item_id, quote_request_id, change_order_id,
      quickbooks_id, source,
      projects(name, project_number),
      estimate_line_items(description, trade, proposal_description),
      quote_requests(subcontractor_name, scope_description)
    `)
    .eq("id", id)
    .maybeSingle();

  if (!inv) return notFound();

  const proj = Array.isArray(inv.projects) ? inv.projects[0] : inv.projects;
  const lineItem = Array.isArray(inv.estimate_line_items) ? inv.estimate_line_items[0] : inv.estimate_line_items;
  const quote = Array.isArray(inv.quote_requests) ? inv.quote_requests[0] : inv.quote_requests;

  // Try to sign the attachment URL — might live in project-files or email-attachments bucket.
  let attachmentUrl: string | null = null;
  if (inv.attachment_storage_path) {
    const tryBuckets = ["email-attachments", "project-files"] as const;
    for (const bucket of tryBuckets) {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(inv.attachment_storage_path, 3600);
      if (data?.signedUrl) {
        attachmentUrl = data.signedUrl;
        break;
      }
    }
  }

  const isPdf = inv.attachment_storage_path?.toLowerCase().endsWith(".pdf");
  const isImage = inv.attachment_storage_path && /\.(png|jpe?g|webp|gif)$/i.test(inv.attachment_storage_path);

  return (
    <>
      <Header title={inv.vendor_name || "Transaction"} backHref="/spent" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8 max-w-4xl mx-auto w-full">
        {/* Hero */}
        <section>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {inv.payment_status === "paid" ? (
              <span className="inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500">
                Paid
              </span>
            ) : (
              <span className="inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500">
                {inv.payment_status || "—"}
              </span>
            )}
            {inv.trade && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {inv.trade}
              </span>
            )}
            {inv.source && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                · {inv.source}
              </span>
            )}
          </div>
          <h1 className="text-[26px] font-bold tracking-tight leading-tight">
            {inv.vendor_name || "Unknown vendor"}
          </h1>
          <div className="text-[12px] text-muted-foreground mt-1">
            {inv.invoice_number ? `Inv ${inv.invoice_number} · ` : ""}
            {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "no date"}
            {inv.due_date ? ` · due ${new Date(inv.due_date).toLocaleDateString()}` : ""}
          </div>

          <div className="mt-4 flex items-baseline gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Amount</div>
              <div className="text-[26px] font-bold tabular-nums">{fmt(Number(inv.amount || 0))}</div>
            </div>
            {Number(inv.paid_amount) > 0 && Number(inv.paid_amount) !== Number(inv.amount) && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Paid</div>
                <div className="text-[18px] font-semibold tabular-nums text-emerald-500">{fmt(Number(inv.paid_amount || 0))}</div>
              </div>
            )}
          </div>
        </section>

        {/* Links */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Project</div>
            {proj ? (
              <Link
                href={`/projects/${inv.project_id}`}
                className="inline-flex items-center gap-1 text-amber-500 hover:underline text-[14px] font-semibold"
              >
                {proj.project_number ? `${proj.project_number} · ` : ""}{proj.name}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <div className="text-[13px] text-muted-foreground italic">Overhead — not tied to a project</div>
            )}
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Line item</div>
            {lineItem ? (
              <div>
                <div className="text-[14px] font-semibold">{lineItem.description || lineItem.trade || "Untitled"}</div>
                {lineItem.proposal_description && (
                  <div className="text-[11.5px] text-muted-foreground mt-1 line-clamp-2">{lineItem.proposal_description}</div>
                )}
              </div>
            ) : (
              <div className="text-[13px] text-muted-foreground italic">Not linked to a line item</div>
            )}
          </div>
        </section>

        {/* Description / notes */}
        {(inv.description || inv.notes) && (
          <section className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Description</div>
            {inv.description && (
              <div className="text-[13px] whitespace-pre-wrap leading-relaxed">{inv.description}</div>
            )}
            {inv.notes && (
              <div className="text-[12px] text-muted-foreground whitespace-pre-wrap mt-2 pt-2 border-t border-border">
                <span className="font-semibold">Notes:</span> {inv.notes}
              </div>
            )}
          </section>
        )}

        {/* Attachment */}
        <section className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Attachment</h2>
            {attachmentUrl && (
              <a
                href={attachmentUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-amber-500 hover:underline"
              >
                Open in new tab <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="p-4">
            {!inv.attachment_storage_path ? (
              <div className="text-[13px] text-muted-foreground italic">No picture on file.</div>
            ) : !attachmentUrl ? (
              <div className="text-[13px] text-red-500">Attachment path on file but couldn't sign the URL.</div>
            ) : isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={attachmentUrl} alt={inv.vendor_name || "invoice"} className="max-w-full rounded-md border border-border" />
            ) : isPdf ? (
              <iframe src={attachmentUrl} className="w-full h-[500px] rounded-md border border-border" title="Invoice PDF" />
            ) : (
              <a
                href={attachmentUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 transition-colors px-3 py-2 text-[13px] font-semibold text-amber-700 dark:text-amber-300"
              >
                <FileText className="h-4 w-4" />
                Open attachment
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}
          </div>
        </section>

        {/* Extracted text (if any) */}
        {inv.extracted_text && (
          <details className="rounded-lg border bg-card overflow-hidden">
            <summary className="px-4 py-3 cursor-pointer text-sm font-semibold list-none flex items-center justify-between">
              <span>Extracted text from the invoice</span>
              <span className="text-[11px] text-muted-foreground font-medium">expand</span>
            </summary>
            <div className="px-4 pb-4 text-[11.5px] text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
              {inv.extracted_text}
            </div>
          </details>
        )}

        {/* Quote origin (if this invoice came from a sub quote) */}
        {quote && (
          <section className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Sub quote origin</div>
            <div className="text-[13px] font-semibold">{quote.subcontractor_name}</div>
            {quote.scope_description && (
              <div className="text-[12px] text-muted-foreground mt-1">{quote.scope_description}</div>
            )}
          </section>
        )}

        {inv.quickbooks_id && (
          <div className="text-[11px] text-muted-foreground">
            QuickBooks ID: <span className="font-mono">{inv.quickbooks_id}</span>
          </div>
        )}
      </div>
    </>
  );
}
