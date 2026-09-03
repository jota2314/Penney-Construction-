import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { FileText, ExternalLink } from "lucide-react";
import { MarkPaidButton } from "@/components/invoices/mark-paid-button";
import { ApprovePayButton } from "@/components/invoices/approve-pay-button";
import { spendCategoryFor } from "@/lib/finance/spend-category";
import { isPayApproved } from "@/lib/finance/pay-approval";
import { LineItemPicker, type PickerLine } from "./line-item-picker";
import { ProjectPicker, type PickerProject } from "./project-picker";

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
      pay_approval_status, pay_approved_at, approved_for_pay_at,
      attachment_storage_path, extracted_text, notes,
      project_id, estimate_line_item_id, quote_request_id, change_order_id,
      quickbooks_id, source, split_group_id,
      pay_approver:profiles!invoices_pay_approved_by_fkey(full_name),
      tab_approver:profiles!invoices_approved_for_pay_by_fkey(full_name),
      projects(name, project_number, is_overhead),
      estimate_line_items(description, trade, proposal_description),
      quote_requests(subcontractor_name, scope_description)
    `)
    .eq("id", id)
    .maybeSingle();

  if (!inv) return notFound();

  const proj = Array.isArray(inv.projects) ? inv.projects[0] : inv.projects;
  const lineItem = Array.isArray(inv.estimate_line_items) ? inv.estimate_line_items[0] : inv.estimate_line_items;
  const quote = Array.isArray(inv.quote_requests) ? inv.quote_requests[0] : inv.quote_requests;
  const listApprover = (Array.isArray(inv.pay_approver) ? inv.pay_approver[0] : inv.pay_approver) as
    | { full_name: string | null }
    | null;
  const tabApprover = (Array.isArray(inv.tab_approver) ? inv.tab_approver[0] : inv.tab_approver) as
    | { full_name: string | null }
    | null;
  const payApprover = listApprover?.full_name ? listApprover : tabApprover;
  const isUnpaid = inv.payment_status !== "paid";
  // Either stamp counts. The project Invoices tab and this page used to write
  // different columns, so a tab approval read as "Needs pay approval" here.
  const payApproved = isPayApproved(inv);

  const category = spendCategoryFor({
    vendorName: inv.vendor_name,
    vendorType: inv.vendor_type,
    trade: inv.trade,
    description: inv.description,
    lineItemText: lineItem?.description,
    isOverhead: !inv.project_id || Boolean((proj as { is_overhead?: boolean | null } | null)?.is_overhead),
  });

  // Budget lines this bill can be booked to — ONLY the estimate in force:
  // current_estimate_id() is the stamped contract estimate, else the highest
  // live version (migration 00114). This page used to list every version on
  // the project, superseded ones included, so a bill could be booked to a v3
  // line that no contract and no budget ever counted. Every other picker
  // (bill drop, crew receipt, review queue, split) already used this rule.
  let pickerLines: PickerLine[] = [];
  if (inv.project_id) {
    const [{ data: currentId }, { data: projectRow }] = await Promise.all([
      supabase.rpc("current_estimate_id", { p_project_id: inv.project_id }),
      supabase.from("projects").select("contract_estimate_id").eq("id", inv.project_id).maybeSingle(),
    ]);
    const estimateId = (currentId as string | null) ?? null;

    if (estimateId) {
      const [{ data: est }, { data: lines }] = await Promise.all([
        supabase.from("estimates").select("id, version, name, status").eq("id", estimateId).maybeSingle(),
        supabase
          .from("estimate_line_items")
          .select("id, estimate_id, description, trade, cost, sort_order, is_section_header, change_order_id, change_orders:change_order_id(change_order_number, status)")
          .eq("estimate_id", estimateId)
          .order("sort_order"),
      ]);

      const isContract = Boolean(projectRow?.contract_estimate_id) && projectRow?.contract_estimate_id === estimateId;
      const name = est?.name && est.name.length > 44 ? `${est.name.slice(0, 44)}…` : est?.name;
      // The header names the budget so it is obvious which version the bill
      // lands on: "Contract · v4 · Revised" for a job under contract, else the
      // live version with its status.
      const label = est
        ? `${isContract ? "Contract · " : ""}v${est.version}${name ? ` · ${name}` : ""}${!isContract && est.status ? ` (${est.status})` : ""}`
        : "Budget lines";

      const coOf = (li: { change_orders?: unknown }) =>
        (Array.isArray(li.change_orders) ? li.change_orders[0] : li.change_orders) as
          | { change_order_number: number | null; status: string | null }
          | null
          | undefined;
      const mine = lines ?? [];
      const toPicker = (li: (typeof mine)[number], description: string): PickerLine => ({
        id: li.id,
        description,
        trade: li.trade ?? null,
        cost: Number(li.cost || 0),
        groupLabel: label,
        isSectionHeader: Boolean(li.is_section_header),
      });
      // Change-order lines are appended to the estimate with a sort_order
      // that lands them mid-list (Caraglia's six COs sat inside "Footings"
      // with nothing saying they were COs — Luis couldn't find the one he'd
      // just written). They get their own section at the end, named by CO.
      const base = mine.filter((li) => !li.change_order_id).map((li) => toPicker(li, li.description || li.trade || "Untitled"));
      const cos = mine
        .filter((li) => !!li.change_order_id)
        .sort((a, b) => (coOf(a)?.change_order_number ?? 0) - (coOf(b)?.change_order_number ?? 0))
        .map((li) => {
          const co = coOf(li);
          const num = co?.change_order_number ? `CO #${co.change_order_number} · ` : "CO · ";
          const state = co?.status && co.status !== "approved" ? ` (${co.status})` : "";
          return toPicker(li, `${num}${li.description || li.trade || "Untitled"}${state}`);
        });
      pickerLines =
        cos.length === 0
          ? base
          : [
              ...base,
              { id: `co-header-${estimateId}`, description: "Change orders", trade: null, cost: 0, groupLabel: label, isSectionHeader: true },
              ...cos,
            ];
    }
  }

  // Pieces of the same original bill (split across budget lines) — shown as
  // one bill with this page's piece highlighted.
  interface SplitPiece {
    id: string;
    amount: number;
    description: string | null;
    payment_status: string | null;
    lineLabel: string | null;
  }
  let splitPieces: SplitPiece[] = [];
  if (inv.split_group_id) {
    const { data: pieces } = await supabase
      .from("invoices")
      .select("id, amount, description, payment_status, estimate_line_items(description, trade)")
      .eq("split_group_id", inv.split_group_id)
      .order("amount", { ascending: false });
    splitPieces = (pieces ?? []).map((p) => {
      const li = Array.isArray(p.estimate_line_items) ? p.estimate_line_items[0] : p.estimate_line_items;
      return {
        id: p.id,
        amount: Number(p.amount || 0),
        description: p.description ?? null,
        payment_status: p.payment_status ?? null,
        lineLabel: li ? (li.description || li.trade || null) : null,
      };
    });
  }
  const splitTotal = splitPieces.reduce((s, p) => s + p.amount, 0);
  const isSplit = splitPieces.length > 1;
  const groupIds = isSplit ? splitPieces.map((p) => p.id) : undefined;

  // Every project, newest first, so a misfiled bill can be moved to the
  // right job from this page.
  const { data: allProjects } = await supabase
    .from("projects")
    .select("id, name, project_number, status, is_overhead")
    .order("project_number", { ascending: false });
  const pickerProjects: PickerProject[] = (allProjects ?? []).map((p) => ({
    id: p.id,
    name: p.name || "Untitled",
    projectNumber: p.project_number ?? null,
    status: p.status ?? null,
    isOverhead: Boolean(p.is_overhead),
  }));

  // Try to sign the attachment URL — might live in project-files or email-attachments bucket.
  let attachmentUrl: string | null = null;
  if (inv.attachment_storage_path) {
    // field-captures holds receipts photographed on the jobsite; without it
    // those invoices render with no attachment at all.
    const tryBuckets = ["email-attachments", "project-files", "field-captures"] as const;
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
            {isUnpaid && payApproved && (
              <span className="inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-500">
                Approved for pay{payApprover?.full_name ? ` · ${payApprover.full_name.split(" ")[0]}` : ""}
              </span>
            )}
            {isUnpaid && !payApproved && inv.pay_approval_status === "pending" && (
              <span className="inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-500">
                Needs pay approval
              </span>
            )}
            <span className={`inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${category.chip}`}>
              {category.label}
            </span>
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
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Books to <span className="font-medium text-foreground/80">{category.qbAccount}</span> in QuickBooks
          </div>

          <div className="mt-4 flex items-baseline gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Amount</div>
              <div className="text-[26px] font-bold tabular-nums">{fmt(Number(inv.amount || 0))}</div>
              {isSplit && (
                <div className="text-[11.5px] text-sky-400 mt-0.5">
                  Part of one {fmt(splitTotal)} bill · split across {splitPieces.length} budget lines
                </div>
              )}
            </div>
            {Number(inv.paid_amount) > 0 && Number(inv.paid_amount) !== Number(inv.amount) && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Paid</div>
                <div className="text-[18px] font-semibold tabular-nums text-emerald-500">{fmt(Number(inv.paid_amount || 0))}</div>
              </div>
            )}
            {isUnpaid && (
              <div className="ml-auto flex items-center gap-2">
                {!payApproved && <ApprovePayButton invoiceId={inv.id} groupIds={groupIds} />}
                <MarkPaidButton invoiceId={inv.id} groupIds={groupIds} />
              </div>
            )}
          </div>
        </section>

        {/* Links */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Project</div>
            <ProjectPicker
              invoiceId={inv.id}
              currentProjectId={inv.project_id ?? null}
              projects={pickerProjects}
            />
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Line item</div>
            <LineItemPicker
              invoiceId={inv.id}
              projectId={inv.project_id ?? null}
              vendorName={inv.vendor_name || "Unknown vendor"}
              invoiceAmount={Number(inv.amount || 0)}
              currentLineItemId={inv.estimate_line_item_id ?? null}
              currentLabel={lineItem ? (lineItem.description || lineItem.trade || "Untitled") : null}
              currentDetail={lineItem?.proposal_description ?? null}
              lines={pickerLines}
            />
          </div>
        </section>

        {/* One bill, several budget lines — the other pieces of this split */}
        {isSplit && (
          <section className="rounded-lg border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">One bill · {splitPieces.length} budget lines</h2>
              <span className="text-[12px] font-semibold tabular-nums">{fmt(splitTotal)}</span>
            </div>
            <div className="divide-y">
              {splitPieces.map((p) => {
                const isThis = p.id === inv.id;
                const body = (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate">
                        {p.lineLabel ?? <span className="italic text-muted-foreground">No budget line yet</span>}
                      </div>
                      {p.description && (
                        <div className="text-[11.5px] text-muted-foreground truncate mt-0.5">{p.description}</div>
                      )}
                    </div>
                    {isThis && (
                      <span className="shrink-0 px-1.5 py-px rounded-full bg-sky-500/15 text-sky-400 text-[9.5px] font-semibold uppercase tracking-wide">
                        This page
                      </span>
                    )}
                    {p.payment_status !== "paid" && (
                      <span className="shrink-0 px-1.5 py-px rounded-full bg-red-500/15 text-red-400 text-[9.5px] font-semibold uppercase tracking-wide">
                        Unpaid
                      </span>
                    )}
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">{fmt(p.amount)}</span>
                  </>
                );
                const rowCls = "px-4 py-2.5 flex items-center gap-2";
                return isThis ? (
                  <div key={p.id} className={`${rowCls} bg-sky-500/5`}>{body}</div>
                ) : (
                  <Link key={p.id} href={`/spent/${p.id}`} className={`${rowCls} hover:bg-muted/40 transition-colors`}>
                    {body}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

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
              <div className="text-[13px] text-red-500">Attachment path on file but couldn&apos;t sign the URL.</div>
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
