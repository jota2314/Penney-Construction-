"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { financialRows } from "@/lib/crew/load-labor-ledger";
import { canCreditSentInvoice, containsChangeOrderCredit, type CreditInvoice, type InvoiceCreditOption } from "@/lib/finance/client-invoice-credits";

export async function getInvoiceCreditOptions(invoiceId: string, projectId: string): Promise<{
  error?: string; invoice?: CreditInvoice; credits?: InvoiceCreditOption[];
}> {
  if (![invoiceId, projectId].every((id) => z.string().uuid().safeParse(id).success)) return { error: "Choose an invoice in this project." };
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["owner", "office_admin", "precon_manager"].includes(profile.role)) return { error: "You don't have access to credit client invoices." };
  try {
    const { data: invoice, error } = await db.from("client_invoices").select("*").eq("id", invoiceId).eq("project_id", projectId).single();
    if (error || !invoice) return { error: "Invoice not found in this project." };
    if (!canCreditSentInvoice(invoice)) return { error: "Credits require a sent, unpaid invoice without external accounting links." };
    const { data: receipts, error: receiptError } = await db.from("payments_received").select("id").eq("client_invoice_id", invoiceId).limit(1);
    if (receiptError) return { error: receiptError.message };
    if (receipts?.length) return { error: "This invoice has a receipt applied. Review the payment before crediting it." };
    const [credits, invoices] = await Promise.all([
      financialRows((from, to) => db.from("change_orders").select("id,change_order_number,title,price_impact,updated_at")
        .eq("project_id", projectId).eq("status", "approved").lt("price_impact", 0).is("client_invoice_id", null)
        .order("change_order_number").order("id").range(from, to)),
      financialRows((from, to) => db.from("client_invoices").select("line_items").eq("project_id", projectId).order("id").range(from, to)),
    ]);
    return { invoice, credits: credits.filter((credit) => !invoices.some((other) => containsChangeOrderCredit(other.line_items, credit))) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not load invoice credits." };
  }
}

export async function applyClientInvoiceCredit(input: {
  invoiceId: string; projectId: string; expectedUpdatedAt: string;
  changeOrderId: string; expectedChangeOrderUpdatedAt: string; reason: string;
}) {
  const parsed = z.object({
    invoiceId: z.string().uuid(), projectId: z.string().uuid(), changeOrderId: z.string().uuid(),
    expectedUpdatedAt: z.string().min(1), expectedChangeOrderUpdatedAt: z.string().min(1),
    reason: z.string().trim().min(1).max(2000),
  }).safeParse(input);
  if (!parsed.success) return { error: "Select an approved credit and enter the reason." };
  const db = await createClient();
  const { data, error } = await db.rpc("apply_client_invoice_credit", {
    p_invoice_id: parsed.data.invoiceId, p_project_id: parsed.data.projectId,
    p_expected_updated_at: parsed.data.expectedUpdatedAt, p_change_order_id: parsed.data.changeOrderId,
    p_expected_change_order_updated_at: parsed.data.expectedChangeOrderUpdatedAt, p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };
  for (const path of [`/projects/${input.projectId}`, "/finances", "/money", "/ceo", "/week"]) revalidatePath(path);
  return { data };
}
