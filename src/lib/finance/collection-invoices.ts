import "server-only";
import { createClient } from "@/lib/supabase/server";
import { collectionPlanProjectIds } from "./published-collection-plan";

export interface CollectionInvoice {
  id: string;
  invoice_number: number;
  title: string;
  amount: number;
  status: string;
  due_date: string | null;
  updated_at: string;
  terms: string | null;
  line_items: { description: string; amount: number }[] | null;
  paid_at: string | null;
  paid_amount: number;
  sent_to_client_at: string | null;
  quickbooks_invoice_id: string | null;
  milestone: { label: string; sort_order: number } | null;
}

export interface CollectionInvoiceProject {
  id: string;
  name: string;
  invoices: CollectionInvoice[];
}

export type CollectionInvoiceProjects = Record<string, CollectionInvoiceProject>;

/** Live native invoices, after CEO authorization. Preserve RLS; failures are not empty inventories. */
export async function getCollectionInvoices(): Promise<CollectionInvoiceProjects | null> {
  const supabase = await createClient();
  const ids = [...new Set(Object.values(collectionPlanProjectIds))];
  const { data: projects, error } = await supabase.from("projects").select("id, name").in("id", ids);
  if (error || !projects) return null;
  const byId: Record<string, CollectionInvoiceProject> = Object.fromEntries(projects.map(project => [project.id, { ...project, invoices: [] }]));
  // Stable pagination avoids silently dropping a project's existing invoices.
  for (let from = 0; ; from += 1000) {
    const { data: rows, error: invoiceError } = await supabase.from("client_invoices")
      .select("id, project_id, invoice_number, title, amount, status, due_date, updated_at, terms, line_items, paid_at, paid_amount, sent_to_client_at, quickbooks_invoice_id")
      .in("project_id", ids).order("invoice_number", { ascending: false }).order("id").range(from, from + 999);
    if (invoiceError || !rows) return null;
    for (const row of rows) {
      byId[row.project_id]?.invoices.push({ ...row, amount: Number(row.amount), paid_amount: Number(row.paid_amount || 0), milestone: null });
    }
    if (rows.length < 1000) break;
  }
  // Use the existing invoice-to-milestone link. A milestone's status can lag
  // behind sending, so the invoice's own status/sent timestamp take precedence.
  for (let from = 0; ; from += 1000) {
    const { data: milestones, error: milestoneError } = await supabase.from("project_payment_milestones")
      .select("project_id, client_invoice_id, label, sort_order").in("project_id", ids).order("id").range(from, from + 999);
    if (milestoneError || !milestones) return null;
    for (const milestone of milestones) {
      const invoice = byId[milestone.project_id]?.invoices.find(row => row.id === milestone.client_invoice_id);
      if (invoice) invoice.milestone = { label: milestone.label, sort_order: milestone.sort_order };
    }
    if (milestones.length < 1000) break;
  }
  return Object.fromEntries(Object.entries(collectionPlanProjectIds).flatMap(([label, id]) => byId[id] ? [[label, byId[id]]] : []));
}
