"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { canApproveBillPay } from "@/lib/auth/role-access";

/**
 * Push a sub bill into next week's pay batch.
 *
 * /week and /spent bucket every bill by invoice_date, and for a sub bill that
 * date IS the week it goes on Jorge's "approved to pay this week" list — not
 * the work date. So "move to next week" is invoice_date + 7 days on every row
 * of the bill (a split bill is one row per budget line, and it moves as one).
 *
 * Same gate as Approve: only the pay approvers decide which week a check is
 * cut. Paid rows never move — their date is tied to bank reconciliation.
 */
export async function pushBillToNextWeek(invoiceIds: string[]): Promise<{ error?: string; movedTo?: string }> {
  const user = await getUser();
  if (!user?.profile) return { error: "Not authenticated" };
  const realEmail = user.realProfile?.email ?? user.email;
  if (!canApproveBillPay(realEmail)) return { error: "Only Jorge or Ryan can move a bill to next week" };

  const ids = [...new Set(invoiceIds.filter(Boolean))];
  if (ids.length === 0) return { error: "No bill selected" };

  const supabase = await createClient();
  const { data: rows, error: readError } = await supabase
    .from("invoices")
    .select("id, invoice_date, payment_status")
    .in("id", ids);
  if (readError) return { error: readError.message };
  if (!rows || rows.length === 0) return { error: "Bill not found" };
  if (rows.some((r) => r.payment_status === "paid")) return { error: "Already paid — the date is locked to the bank" };
  if (rows.some((r) => !r.invoice_date)) return { error: "Bill has no invoice date" };

  let movedTo = "";
  for (const r of rows) {
    // Date-only math in UTC so a Monday stays a Monday regardless of server TZ.
    const d = new Date(`${String(r.invoice_date).slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    const next = d.toISOString().slice(0, 10);
    movedTo = movedTo || next;
    const { error } = await supabase.from("invoices").update({ invoice_date: next }).eq("id", r.id);
    if (error) return { error: error.message };
  }

  revalidatePath("/week");
  revalidatePath("/spent");
  revalidatePath("/invoices");
  for (const id of ids) revalidatePath(`/spent/${id}`);
  return { movedTo };
}
