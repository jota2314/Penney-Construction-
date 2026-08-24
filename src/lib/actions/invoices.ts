"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { pushClientInvoiceToQuickBooks } from "@/lib/quickbooks/invoices";
import { resolveSubcontractorId } from "@/lib/subs/resolve-subcontractor";
import { resolveVendorType } from "@/lib/finance/spend-category";
import type { InvoicePaymentStatus } from "@/types/database";

interface InvoiceInput {
  project_id: string;
  vendor_name: string;
  vendor_type?: string;
  trade?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  terms?: string;
  description?: string;
  amount?: number;
  notes?: string;
  quote_request_id?: string;
  gmail_message_id?: string;
  attachment_storage_path?: string;
  extracted_text?: string;
}

export async function createInvoice(input: InvoiceInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase.from("invoices").insert({
    project_id: input.project_id,
    vendor_name: input.vendor_name,
    subcontractor_id: await resolveSubcontractorId(supabase, input.vendor_name),
    vendor_type: resolveVendorType(input.vendor_name, input.vendor_type),
    trade: input.trade || null,
    invoice_number: input.invoice_number || null,
    invoice_date: input.invoice_date || null,
    due_date: input.due_date || null,
    terms: input.terms || null,
    description: input.description || null,
    amount: input.amount || 0,
    notes: input.notes || null,
    quote_request_id: input.quote_request_id || null,
    gmail_message_id: input.gmail_message_id || null,
    attachment_storage_path: input.attachment_storage_path || null,
    extracted_text: input.extracted_text || null,
    created_by: user.id,
  }).select().single();

  if (error) return { error: error.message };
  revalidatePath("/projects");
  return { data };
}

// ── Client invoices (money the CLIENT owes Penney) ──────────────────────────

interface ClientInvoiceLineItem {
  description: string;
  amount: number;
}

interface ClientInvoiceInput {
  project_id: string;
  title: string;
  description?: string;
  line_items?: ClientInvoiceLineItem[];
  terms?: string;
  due_date?: string;
  notes?: string;
  /**
   * Hold the QuickBooks mirror until the invoice is actually sent. Signing a
   * contract premakes one draft invoice per payment milestone; pushing all of
   * them to QBO on day one would post invoices we have not billed yet.
   * /api/send-client-invoice pushes on send instead.
   */
  skip_quickbooks?: boolean;
}

export async function createClientInvoice(input: ClientInvoiceInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const lineItems = (input.line_items ?? []).filter((li) => li.description?.trim());
  const amount = lineItems.length > 0
    ? lineItems.reduce((sum, li) => sum + (Number(li.amount) || 0), 0)
    : 0;

  // Next per-project invoice number (mirrors change_orders).
  const { data: existing } = await supabase
    .from("client_invoices")
    .select("invoice_number")
    .eq("project_id", input.project_id)
    .order("invoice_number", { ascending: false })
    .limit(1);
  const nextNumber = (existing?.[0]?.invoice_number ?? 0) + 1;

  const { data, error } = await supabase.from("client_invoices").insert({
    project_id: input.project_id,
    invoice_number: nextNumber,
    title: input.title,
    description: input.description || null,
    line_items: lineItems,
    amount,
    terms: input.terms || "Due on receipt",
    due_date: input.due_date || null,
    notes: input.notes || null,
    status: "draft",
    created_by: user.id,
  }).select().single();

  if (error) return { error: error.message };

  // QuickBooks is deliberately NOT touched here. Invoices (including the
  // batch premade at contract signing) only reach QuickBooks through the
  // explicit "Create in QuickBooks" button → syncClientInvoiceToQuickBooks.

  revalidatePath(`/projects/${input.project_id}`);
  return { data };
}

/** Manually (re)push a client invoice to QuickBooks. */
export async function syncClientInvoiceToQuickBooks(invoiceId: string, projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  try {
    const result = await pushClientInvoiceToQuickBooks(invoiceId);
    if (!result.error) revalidatePath(`/projects/${projectId}`);
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "QuickBooks sync failed" };
  }
}

export async function deleteClientInvoice(invoiceId: string, projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("client_invoices").delete().eq("id", invoiceId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function markClientInvoicePaid(
  invoiceId: string,
  projectId: string,
  paidAmount?: number,
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: inv, error: invErr } = await supabase
    .from("client_invoices")
    .select("id, project_id, invoice_number, title, amount")
    .eq("id", invoiceId)
    .single();
  if (invErr || !inv) return { error: invErr?.message ?? "Invoice not found" };

  const paid = paidAmount != null ? paidAmount : Number(inv.amount) || 0;
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from("client_invoices").update({
    status: "paid",
    paid_at: nowIso,
    paid_amount: paid,
    updated_at: nowIso,
  }).eq("id", invoiceId);
  if (error) return { error: error.message };

  // The other half of the books: marking paid must RECORD the payment.
  // Without this, the invoice leaves "owed to us" (A/R only counts 'sent')
  // while the cash never enters payments_received — the money vanishes from
  // both sides at once. One payment per invoice: skip if one is already
  // linked (e.g. recorded first via deposit capture).
  const { data: milestones } = await supabase
    .from("project_payment_milestones")
    .select("id, stage_key")
    .eq("client_invoice_id", invoiceId)
    .limit(1);
  const milestone = milestones?.[0] ?? null;

  const { data: existingPayment } = await supabase
    .from("payments_received")
    .select("id")
    .eq("client_invoice_id", invoiceId)
    .limit(1);

  if (!existingPayment?.length) {
    const stage = milestone?.stage_key ?? "";
    const paymentType =
      stage === "deposit" ? "deposit" : /final/i.test(stage) ? "final" : "draw";
    const { error: payErr } = await supabase.from("payments_received").insert({
      project_id: inv.project_id,
      payment_type: paymentType,
      description: `Invoice #${inv.invoice_number} — ${inv.title}`,
      amount: paid,
      received_date: nowIso.split("T")[0],
      client_invoice_id: invoiceId,
      source: "invoice_paid",
      created_by: user.id,
    });
    if (payErr) {
      return { error: `Invoice is marked paid, but recording the payment failed: ${payErr.message}` };
    }
  }

  // Keep the payment schedule honest: the linked milestone shows paid too.
  if (milestone) {
    await supabase
      .from("project_payment_milestones")
      .update({ status: "paid", updated_at: nowIso })
      .eq("id", milestone.id);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/payments");
  return { success: true };
}

export async function updateInvoicePayment(
  invoiceId: string,
  status: InvoicePaymentStatus,
  paidAmount?: number,
  paidDate?: string
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const updates: Record<string, unknown> = {
    payment_status: status,
    updated_at: new Date().toISOString(),
  };

  if (status === "paid") {
    updates.paid_date = paidDate || new Date().toISOString().split("T")[0];
    // If no explicit paid_amount, fetch the invoice amount
    if (paidAmount != null) {
      updates.paid_amount = paidAmount;
    } else {
      const { data: inv } = await supabase.from("invoices").select("amount").eq("id", invoiceId).single();
      if (inv) updates.paid_amount = inv.amount;
    }
  } else if (status === "partial" && paidAmount != null) {
    updates.paid_amount = paidAmount;
  } else if (status === "unpaid") {
    updates.paid_amount = 0;
    updates.paid_date = null;
  }

  const { error } = await supabase.from("invoices").update(updates).eq("id", invoiceId);
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return { success: true };
}

export async function deleteInvoice(invoiceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return { success: true };
}

export async function getProjectInvoices(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("project_id", projectId)
    .order("invoice_date", { ascending: false });

  if (error) return { error: error.message, data: [] };
  return { data: data ?? [] };
}

export async function getProjectFinancialSummary(projectId: string) {
  const supabase = await createClient();

  const [{ data: invoices }, { data: quotes }, { data: project }] = await Promise.all([
    supabase.from("invoices").select("amount, paid_amount, payment_status").eq("project_id", projectId),
    supabase.from("quote_requests").select("amount").eq("project_id", projectId),
    supabase.from("projects").select("estimated_value, contract_value").eq("id", projectId).single(),
  ]);

  const totalInvoiced = (invoices ?? []).reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const totalPaid = (invoices ?? []).reduce((sum, i) => sum + (Number(i.paid_amount) || 0), 0);
  const totalQuoted = (quotes ?? []).reduce((sum, q) => sum + (Number(q.amount) || 0), 0);
  const unpaidCount = (invoices ?? []).filter(i => i.payment_status !== "paid").length;

  return {
    estimatedValue: project?.estimated_value ?? 0,
    contractValue: project?.contract_value ?? 0,
    totalQuoted,
    totalInvoiced,
    totalPaid,
    outstanding: totalInvoiced - totalPaid,
    invoiceCount: (invoices ?? []).length,
    unpaidCount,
  };
}
