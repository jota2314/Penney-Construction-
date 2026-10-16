import type { SupabaseClient } from "@supabase/supabase-js";
import { BILL_PAY_APPROVER_NAMES, canApproveBillPay } from "@/lib/auth/role-access";
import { buildOpenBills, type BillRecord } from "@/lib/finance/open-bills";
import { isPayApproved } from "@/lib/finance/pay-approval";
import { notifyBillApprovedForPay } from "@/lib/notifications/tagged-mentions";

/**
 * Bill pay approval for callers with no browser session: the Penney MCP
 * (Claude, ChatGPT/Codex) posts here through /api/bills/pay-approval with a
 * verified actor id. Same gate, same two stamps and same "good to pay" notice
 * as approveBillForPay, so an approval from chat is indistinguishable from
 * one made in the app.
 */

const APP_URL = process.env.APP_BASE_URL ?? "https://www.penneyconstruction.build";
const FINANCE_VIEWER_ROLES = ["owner", "office_admin", "precon_manager"];

export class PayApprovalError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Actor = { id: string; email: string | null; full_name: string | null; role: string | null };

async function loadActor(admin: SupabaseClient, actorId: string): Promise<Actor> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", actorId)
    .maybeSingle();
  if (error || !data) throw new PayApprovalError("Unknown caller", 401);
  return data as Actor;
}

/**
 * Every open vendor bill that has not been approved for pay, grouped the way
 * the office sees it (split allocations are one bill). hold_reasons are the
 * same checks the CEO and finance workspaces use; they are shown, not
 * enforced, exactly like the Approve buttons in the app.
 */
export async function listBillsAwaitingApproval(
  admin: SupabaseClient,
  actorId: string,
  projectId?: string,
) {
  const actor = await loadActor(admin, actorId);
  const canApprove = canApproveBillPay(actor.email);
  if (!canApprove && !FINANCE_VIEWER_ROLES.includes(actor.role ?? "")) {
    throw new PayApprovalError("Office financial access required", 403);
  }

  let query = admin
    .from("invoices")
    .select("id, project_id, vendor_name, description, amount, paid_amount, payment_status, payment_method, invoice_date, due_date, invoice_number, source, review_status, review_reason, duplicate_of_id, split_group_id, estimate_line_item_id, pay_approval_status, approved_for_pay_at, projects(name, project_number)")
    .is("duplicate_of_id", null)
    .or("payment_status.is.null,payment_status.neq.paid")
    .order("invoice_date", { ascending: true })
    .order("id")
    .limit(1000);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) throw new PayApprovalError("Unable to load open bills", 500);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const open = buildOpenBills((data ?? []) as unknown as BillRecord[], today);
  const awaiting = [...open.bills, ...open.review]
    .filter((bill) => !bill.approved)
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.vendor.localeCompare(b.vendor))
    .map((bill) => ({
      invoice_ids: bill.recordIds,
      vendor: bill.vendor,
      invoice_number: bill.reference,
      jobs: bill.projects,
      open_amount: bill.amount,
      due_date: bill.dueDate,
      overdue_days: bill.overdueDays,
      hold_reasons: bill.reasons,
      app_url: `${APP_URL}/spent/${bill.id}`,
    }));

  return {
    caller_can_approve: canApprove,
    approvers: BILL_PAY_APPROVER_NAMES,
    awaiting_approval: awaiting,
    count: awaiting.length,
  };
}

/**
 * Approve one bill for pay. invoice_ids are the bill's record ids from
 * listBillsAwaitingApproval; any other pieces of the same split bill are
 * pulled in too, because it is one check to one vendor (ApprovePayButton
 * does the same with groupIds). Already-approved pieces are left alone.
 */
export async function approveBillsForPayAsActor(
  admin: SupabaseClient,
  actorId: string,
  invoiceIds: string[],
) {
  const actor = await loadActor(admin, actorId);
  if (!canApproveBillPay(actor.email)) {
    throw new PayApprovalError(`Only ${BILL_PAY_APPROVER_NAMES} can approve bills for pay`, 403);
  }

  const columns = "id, vendor_name, amount, payment_status, pay_approval_status, approved_for_pay_at, invoice_number, due_date, split_group_id, project_id, projects(name, project_number)";
  const { data: given, error } = await admin.from("invoices").select(columns).in("id", invoiceIds);
  if (error) throw new PayApprovalError("Unable to load the bill", 500);
  if (!given || given.length !== new Set(invoiceIds).size) throw new PayApprovalError("Bill not found", 404);

  const groups = [...new Set(given.map((row) => row.split_group_id).filter(Boolean))] as string[];
  let rows = given;
  if (groups.length) {
    const { data: siblings, error: siblingError } = await admin
      .from("invoices")
      .select(columns)
      .in("split_group_id", groups)
      .is("duplicate_of_id", null);
    if (siblingError) throw new PayApprovalError("Unable to load the split bill", 500);
    const byId = new Map([...given, ...(siblings ?? [])].map((row) => [row.id, row]));
    rows = [...byId.values()];
  }

  if (rows.some((row) => row.payment_status === "paid")) {
    throw new PayApprovalError("Part of this bill is already paid; approve it in the app", 409);
  }

  const pending = rows.filter((row) => !isPayApproved(row));
  const head = given[0];
  const result = {
    vendor: head.vendor_name || "Unknown vendor",
    invoice_number: head.invoice_number,
    approved_ids: pending.map((row) => row.id),
    already_approved_ids: rows.filter((row) => isPayApproved(row)).map((row) => row.id),
    approved_by: actor.full_name || actor.email,
    app_url: `${APP_URL}/spent/${head.id}`,
  };
  if (!pending.length) return { ...result, already_approved: true };

  // Both approval stamps, so the project Invoices tab and the lists agree.
  // The null guards keep a concurrent approval in the app from being
  // overwritten with this caller's name.
  const approvedAt = new Date().toISOString();
  const { data: stamped, error: updateError } = await admin
    .from("invoices")
    .update({
      pay_approval_status: "approved",
      pay_approved_by: actor.id,
      pay_approved_at: approvedAt,
      approved_for_pay_at: approvedAt,
      approved_for_pay_by: actor.id,
      updated_at: approvedAt,
    })
    .in("id", result.approved_ids)
    .is("approved_for_pay_at", null)
    .or("payment_status.is.null,payment_status.neq.paid")
    .select("id, amount");
  if (updateError) throw new PayApprovalError(updateError.message, 500);

  const stampedIds = (stamped ?? []).map((row) => row.id);
  const amount = (stamped ?? []).reduce((sum, row) => sum + Math.round(Number(row.amount ?? 0) * 100), 0) / 100;

  // One notice per check, not per split piece. A notify failure never
  // undoes the approval.
  if (stampedIds.length) {
    try {
      const project = (Array.isArray(head.projects) ? head.projects[0] : head.projects) as
        | { name: string; project_number: string | null }
        | null;
      await notifyBillApprovedForPay({
        actorId: actor.id,
        actorName: actor.full_name || "Someone",
        invoiceId: stampedIds[0],
        vendorName: result.vendor,
        amount,
        projectLabel: project ? [project.project_number, project.name].filter(Boolean).join(" ") : "no job",
        invoiceNumber: head.invoice_number,
        dueDate: head.due_date,
        url: `/spent/${stampedIds[0]}`,
      });
    } catch (err) {
      console.error("[pay-approval-service] notify failed", {
        invoiceIds: stampedIds,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ...result, approved_ids: stampedIds, approved_amount: amount, approved_at: approvedAt };
}
