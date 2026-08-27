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

export type PayerOption = { id: string; name: string };

/*
 * The office bill dialog gets its job list from listCaptureJobOptions()
 * (@/lib/actions/field-capture) — the SAME picker the crew capture and the
 * spend organizer use. There used to be a listBillJobOptions() here that
 * filtered `status.in.(contracted,in_progress)` plus overhead, which showed
 * 27 of 121 jobs.
 *
 * That silently broke filing: a sub's FINAL invoice arrives after the job has
 * moved to `audit`, so the job it belongs to was not in the dropdown at all.
 * Picardi Electric's #3358 for Weidlein Bathroom (PC-2026-067, audit) is the
 * case in point — Nicole had no pickable destination and had to file it with
 * no job, where it landed outside every "needs a job" count.
 *
 * A bill can belong to a job in ANY state (a permit on a lead that never
 * signed is still that lead's cost), so never re-narrow this by status. Sort
 * the buckets, don't filter them.
 */

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
 * Can the person looking at this screen approve a bill for pay? The UI asks
 * so it can render the button at all; approveBillsForPay re-checks it, so a
 * `true` here is a convenience, never the gate.
 */
export async function canApproveBills(): Promise<boolean> {
  const user = await getUser();
  if (!user) return false;
  // The REAL account, so View-as can't borrow someone else's authority.
  return canApproveBillPay(user.realProfile?.email ?? user.email);
}

/**
 * Approve unpaid bills for payment — the green light Nicole waits on.
 *
 * Takes a LIST because one filed bill can become several invoices rows when
 * it's split across budget lines. Approving one row and leaving its siblings
 * pending would show Nicole half a bill she may pay, so they move together
 * and she gets ONE ping for the whole thing.
 *
 * The approver allowlist is the gate — the button can render for anyone, the
 * action holds. Jorge or Ryan approve; Nicole pays; the two are never the
 * same person.
 */
export async function approveBillsForPay(
  invoiceIds: string[],
): Promise<{ error?: string; approved?: number }> {
  const user = await getUser();
  const profile = user?.profile;
  if (!user || !profile) return { error: "Not authenticated" };
  // Impersonation check on the REAL account, so View-as can't approve.
  const realEmail = user.realProfile?.email ?? user.email;
  if (!canApproveBillPay(realEmail)) {
    return { error: "Only Jorge or Ryan can approve bills for pay" };
  }

  const ids = [...new Set(invoiceIds.filter(Boolean))];
  if (ids.length === 0) return { error: "No bill to approve" };

  const supabase = await createClient();
  const { data: bills } = await supabase
    .from("invoices")
    .select("id, vendor_name, amount, payment_status, pay_approval_status, invoice_number, due_date, project_id, projects(name, project_number)")
    .in("id", ids);
  if (!bills || bills.length === 0) return { error: "Bill not found" };

  const payable = bills.filter(
    (b) => b.payment_status !== "paid" && b.pay_approval_status !== "approved",
  );
  if (payable.length === 0) {
    return { error: bills.some((b) => b.payment_status === "paid") ? "Already paid" : "Already approved" };
  }

  const { error } = await supabase
    .from("invoices")
    .update({
      pay_approval_status: "approved",
      pay_approved_by: profile.id,
      pay_approved_at: new Date().toISOString(),
    })
    .in("id", payable.map((b) => b.id));
  if (error) return { error: error.message };

  // Best-effort ping to Nicole — a notify failure never undoes the approval.
  try {
    const head = payable[0];
    const proj = (Array.isArray(head.projects) ? head.projects[0] : head.projects) as
      | { name: string; project_number: string | null }
      | null;
    await notifyBillApprovedForPay({
      actorId: profile.id,
      actorName: profile.full_name || "Someone",
      invoiceId: head.id,
      vendorName: head.vendor_name || "Unknown vendor",
      // The whole bill, not the one split row the ping happens to point at.
      amount: payable.reduce((sum, b) => sum + Number(b.amount ?? 0), 0) || null,
      projectLabel: proj
        ? [proj.project_number, proj.name].filter(Boolean).join(" ")
        : "no job",
      invoiceNumber: head.invoice_number,
      dueDate: head.due_date,
      url: `/spent/${head.id}`,
    });
  } catch (err) {
    console.error("[approveBillsForPay] notify failed", {
      invoiceIds: payable.map((b) => b.id),
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath("/invoices");
  revalidatePath("/spent");
  revalidatePath("/command-center");
  for (const b of payable) revalidatePath(`/spent/${b.id}`);
  return { approved: payable.length };
}

/** Single-bill approve — what the /spent/[id] button calls. */
export async function approveBillForPay(invoiceId: string): Promise<{ error?: string }> {
  const { error } = await approveBillsForPay([invoiceId]);
  return error ? { error } : {};
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
