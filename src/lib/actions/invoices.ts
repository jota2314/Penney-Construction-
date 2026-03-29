"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
    vendor_type: input.vendor_type || "subcontractor",
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
