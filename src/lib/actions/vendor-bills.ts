"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { canApproveBillPay } from "@/lib/auth/role-access";
import { notifyBillApprovedForPay } from "@/lib/notifications/tagged-mentions";
import { pushVendorExpenseToQuickBooks } from "@/lib/quickbooks/expenses";

/**
 * Office-side vendor bill helpers: the pickers behind the "Add a bill" dialog
 * and the mark-paid action that turns an A/P bill into a booked payment (and
 * mirrors it into QuickBooks on the payer's card).
 */

export type BillJobOption = { id: string; label: string; isOverhead: boolean };
export type PayerOption = { id: string; name: string };

/** Active jobs PLUS the overhead project — an office bill can be either. */
export async function listBillJobOptions(): Promise<BillJobOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, project_number, is_overhead, status")
    .or("status.in.(contracted,in_progress),is_overhead.eq.true")
    .order("name", { ascending: true })
    .limit(200);

  const rows = (data ?? []).map((p) => ({
    id: p.id,
    label: [p.project_number, p.name].filter(Boolean).join(" "),
    isOverhead: Boolean(p.is_overhead),
  }));
  // Overhead pinned to the top — it's the pick for every not-a-jobsite bill.
  return [...rows.filter((r) => r.isOverhead), ...rows.filter((r) => !r.isOverhead)];
}

/** Everyone who could have paid a bill (card-holder matching for QB). */
export async function listPayerOptions(): Promise<PayerOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .order("full_name", { ascending: true })
    .limit(50);
  const seen = new Set<string>();
  return (data ?? [])
    .filter((p) => p.full_name && !seen.has(p.full_name) && seen.add(p.full_name))
    .map((p) => ({ id: p.id, name: p.full_name as string }));
}

/**
 * Approve an unpaid bill for payment. PMs file the invoice; Jorge or Ryan
 * approve; the approval pings Nicole that it's good to pay. The approver
 * allowlist is the gate — the button can render for anyone, the action holds.
 */
export async function approveBillForPay(invoiceId: string): Promise<{ error?: string }> {
  const user = await getUser();
  const profile = user?.profile;
  if (!user || !profile) return { error: "Not authenticated" };
  // Impersonation check on the REAL account, so View-as can't approve.
  const realEmail = user.realProfile?.email ?? user.email;
  if (!canApproveBillPay(realEmail)) {
    return { error: "Only Jorge or Ryan can approve bills for pay" };
  }

  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("invoices")
    .select("id, vendor_name, amount, payment_status, pay_approval_status, invoice_number, due_date, project_id, projects(name, project_number)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!bill) return { error: "Bill not found" };
  if (bill.payment_status === "paid") return { error: "Already paid" };
  if (bill.pay_approval_status === "approved") return { error: "Already approved" };

  const { error } = await supabase
    .from("invoices")
    .update({
      pay_approval_status: "approved",
      pay_approved_by: profile.id,
      pay_approved_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);
  if (error) return { error: error.message };

  // Best-effort ping to Nicole — a notify failure never undoes the approval.
  try {
    const proj = (Array.isArray(bill.projects) ? bill.projects[0] : bill.projects) as
      | { name: string; project_number: string | null }
      | null;
    await notifyBillApprovedForPay({
      actorId: profile.id,
      actorName: profile.full_name || "Someone",
      invoiceId,
      vendorName: bill.vendor_name || "Unknown vendor",
      amount: bill.amount === null ? null : Number(bill.amount),
      projectLabel: proj
        ? [proj.project_number, proj.name].filter(Boolean).join(" ")
        : "no job",
      invoiceNumber: bill.invoice_number,
      dueDate: bill.due_date,
      url: `/spent/${invoiceId}`,
    });
  } catch (err) {
    console.error("[approveBillForPay] notify failed", {
      invoiceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath("/invoices");
  revalidatePath("/spent");
  revalidatePath(`/spent/${invoiceId}`);
  return {};
}

/**
 * An unpaid bill got paid. Book the payment and mirror it into QuickBooks —
 * the QB push is idempotent and records its own failures, so a QBO hiccup
 * never blocks the payment from being recorded.
 */
export async function markBillPaid(input: {
  invoiceId: string;
  method: "credit_card" | "check" | "cash" | "ach";
  paidById?: string;
  paidDate?: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: bill } = await supabase
    .from("invoices")
    .select("id, amount, payment_status")
    .eq("id", input.invoiceId)
    .maybeSingle();
  if (!bill) return { error: "Bill not found" };
  if (bill.payment_status === "paid") return { error: "Already marked paid" };

  const paidDate =
    input.paidDate && /^\d{4}-\d{2}-\d{2}$/.test(input.paidDate)
      ? input.paidDate
      : new Date().toISOString().slice(0, 10);

  const { error } = await supabase
    .from("invoices")
    .update({
      payment_status: "paid",
      paid_amount: bill.amount,
      paid_date: paidDate,
      payment_method: input.method,
      paid_by_profile_id: input.paidById ?? null,
    })
    .eq("id", input.invoiceId);
  if (error) return { error: error.message };

  await pushVendorExpenseToQuickBooks([input.invoiceId]);

  revalidatePath("/invoices");
  revalidatePath("/spent");
  revalidatePath(`/spent/${input.invoiceId}`);
  return {};
}
