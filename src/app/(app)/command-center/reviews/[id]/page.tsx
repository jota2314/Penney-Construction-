import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { ReviewActions } from "./review-actions";
import { LineItemRow } from "./line-item-row";
import { EditableProjectScope } from "./editable-scope";
import { ArrowLeft, CheckCircle2, AlertCircle, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Review | Penney Construction" };

interface EstimateDetail {
  id: string;
  name: string | null;
  total_cost: number | string | null;
  total_price: number | string | null;
  markup_percentage: number | string | null;
  notes: string | null;
  approval_status: string;
  approval_notes: string | null;
  submitted_for_review_at: string | null;
  reviewed_at: string | null;
  project_id: string | null;
}

interface LineItemRow {
  id: string;
  description: string | null;
  proposal_description: string | null;
  trade: string | null;
  quantity: number | string | null;
  unit: string | null;
  unit_cost: number | string | null;
  total_cost: number | string | null;
  total_price: number | string | null;
  sort_order: number;
}

interface ProjectRow {
  id: string;
  name: string;
  project_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  project_type: string | null;
  scope_of_work: string | null;
  customer_id: string | null;
}

interface CustomerRow { first_name: string; last_name: string; email: string | null; phone: string | null }

interface ApprovalRow {
  id: string;
  action: string;
  actor_email: string | null;
  notes: string | null;
  created_at: string;
}

function n(v: number | string | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : Number(v) || 0;
}
function fmtMoney(v: number | string | null | undefined): string {
  return "$" + n(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const { data: estRaw } = await supabase
    .from("estimates")
    .select("id, name, total_cost, total_price, markup_percentage, notes, approval_status, approval_notes, submitted_for_review_at, reviewed_at, project_id")
    .eq("id", id)
    .maybeSingle<EstimateDetail>();
  if (!estRaw) return notFound();
  const estimate = estRaw;

  let project: ProjectRow | null = null;
  let customer: CustomerRow | null = null;
  if (estimate.project_id) {
    const { data: p } = await supabase
      .from("projects")
      .select("id, name, project_number, address, city, state, project_type, scope_of_work, customer_id")
      .eq("id", estimate.project_id)
      .maybeSingle<ProjectRow>();
    project = p || null;
    if (p?.customer_id) {
      const { data: c } = await supabase
        .from("customers")
        .select("first_name, last_name, email, phone")
        .eq("id", p.customer_id)
        .maybeSingle<CustomerRow>();
      customer = c || null;
    }
  }

  const { data: lineItemsRaw } = await supabase
    .from("estimate_line_items")
    .select("id, description, proposal_description, trade, quantity, unit, unit_cost, cost, client_price, total_cost, total_price, sort_order")
    .eq("estimate_id", id)
    .order("sort_order", { ascending: true });
  // Active columns (cost/client_price) win over the legacy total_* mirrors,
  // which can hold stale values from before dual-column sync.
  type RawLine = LineItemRow & { cost: number | null; client_price: number | null };
  const lineItems: LineItemRow[] = ((lineItemsRaw as RawLine[] | null) || []).map((li) => ({
    ...li,
    total_cost: li.cost ?? li.total_cost,
    total_price: li.client_price ?? li.total_price,
  }));

  const { data: history } = await supabase
    .from("estimate_approvals")
    .select("id, action, actor_email, notes, created_at")
    .eq("estimate_id", id)
    .order("created_at", { ascending: false });

  const totalCost = n(estimate.total_cost) || lineItems.reduce((s, l) => s + n(l.total_cost), 0);
  const totalPrice = n(estimate.total_price) || lineItems.reduce((s, l) => s + n(l.total_price), 0);
  const marginDollars = Math.max(0, totalPrice - totalCost);
  const marginPct = totalPrice > 0 ? (marginDollars / totalPrice) * 100 : 0;

  const isPending = estimate.approval_status === "pending_review";
  const isApproved = estimate.approval_status === "approved";
  const isChanges = estimate.approval_status === "changes_requested";

  return (
    <div className="flex flex-1 flex-col min-w-0 overflow-auto bg-background">
      <div className="mx-auto w-full max-w-4xl px-6 py-6 sm:px-8 sm:py-7 pb-32">
        <div className="mb-4">
          <Link
            href="/command-center/reviews"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All reviews
          </Link>
        </div>

        {/* Hero — project + client + big totals */}
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <StatusChip status={estimate.approval_status} />
            {estimate.submitted_for_review_at && (
              <span className="text-[11px] text-muted-foreground">
                Submitted {fmtDateTime(estimate.submitted_for_review_at)}
              </span>
            )}
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight leading-tight">
            {project?.name || estimate.name || "Proposal review"}
          </h1>
          {project?.project_number && (
            <div className="font-mono text-[12px] text-muted-foreground mt-1">{project.project_number}</div>
          )}
          <div className="flex items-center gap-5 flex-wrap mt-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Client price</div>
              <div className="text-[26px] font-bold tabular-nums">{fmtMoney(totalPrice)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Cost</div>
              <div className="text-[18px] font-semibold tabular-nums text-muted-foreground">{fmtMoney(totalCost)}</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-400">Margin</div>
              <div className="text-[16px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {fmtMoney(marginDollars)} · {marginPct.toFixed(0)}%
              </div>
            </div>
          </div>
        </section>

        {/* Client + project context */}
        {(project || customer) && (
          <section className="bg-card border border-border rounded-xl p-5 mb-4 shadow-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {customer && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Client</div>
                  <div className="text-[14px] font-semibold">{customer.first_name} {customer.last_name}</div>
                  {customer.email && <div className="text-[12px] text-muted-foreground">{customer.email}</div>}
                  {customer.phone && <div className="text-[12px] text-muted-foreground">{customer.phone}</div>}
                </div>
              )}
              {project && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Project</div>
                  <div className="text-[14px] font-semibold">{project.project_type || "—"}</div>
                  {(project.address || project.city) && (
                    <div className="text-[12px] text-muted-foreground">
                      {[project.address, project.city, project.state].filter(Boolean).join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>
            {project && (project.scope_of_work || isPending) && (
              <EditableProjectScope
                estimateId={id}
                projectId={project.id}
                initialScope={project.scope_of_work || ""}
                editable={isPending}
              />
            )}
          </section>
        )}

        {/* Line items */}
        <section className="bg-card border border-border rounded-xl overflow-hidden mb-4 shadow-xs">
          <div className="px-5 py-3 border-b border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Line items · {lineItems.length}</div>
          </div>
          {lineItems.length === 0 ? (
            <div className="px-5 py-6 text-sm text-muted-foreground">No line items on this estimate.</div>
          ) : (
            <div className="divide-y divide-border">
              {lineItems.map(li => (
                <LineItemRow
                  key={li.id}
                  estimateId={id}
                  editable={isPending}
                  item={{
                    id: li.id,
                    description: li.description,
                    proposal_description: li.proposal_description,
                    trade: li.trade,
                    quantity: li.quantity,
                    unit: li.unit,
                    unit_cost: li.unit_cost,
                    total_cost: li.total_cost,
                    total_price: li.total_price,
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Previous rounds / decision notes */}
        {(history && history.length > 0) && (
          <section className="bg-card border border-border rounded-xl p-5 mb-4 shadow-xs">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">History</div>
            <ul className="flex flex-col gap-3 list-none p-0 m-0">
              {(history as ApprovalRow[]).map(h => (
                <li key={h.id} className="flex items-start gap-3">
                  <HistoryIcon action={h.action} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold capitalize">
                      {h.action.replace("_", " ")}
                      {h.actor_email && <span className="text-muted-foreground font-normal"> · {h.actor_email}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{fmtDateTime(h.created_at)}</div>
                    {h.notes && (
                      <div className="text-[13px] mt-1.5 p-2.5 rounded-md bg-muted/50 whitespace-pre-wrap">{h.notes}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Decision block — the only thing that's interactive */}
        <ReviewActions
          estimateId={id}
          isPending={isPending}
          isApproved={isApproved}
          isChanges={isChanges}
          existingNotes={estimate.approval_notes || ""}
        />
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === "approved") return <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Approved</span>;
  if (status === "changes_requested") return <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400"><AlertCircle className="h-3 w-3" /> Changes requested</span>;
  if (status === "pending_review") return <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400"><Clock className="h-3 w-3" /> Pending review</span>;
  return <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full bg-muted text-muted-foreground">Draft</span>;
}

function HistoryIcon({ action }: { action: string }) {
  if (action === "approved") return <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />;
  if (action === "changes_requested") return <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />;
  return <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />;
}
