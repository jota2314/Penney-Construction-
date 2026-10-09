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
      .select("id, project_id, invoice_number, title, amount, status, due_date")
      .in("project_id", ids).order("invoice_number", { ascending: false }).order("id").range(from, from + 999);
    if (invoiceError || !rows) return null;
    for (const row of rows) {
      byId[row.project_id]?.invoices.push({ id: row.id, invoice_number: row.invoice_number, title: row.title, amount: Number(row.amount), status: row.status, due_date: row.due_date });
    }
    if (rows.length < 1000) break;
  }
  return Object.fromEntries(Object.entries(collectionPlanProjectIds).flatMap(([label, id]) => byId[id] ? [[label, byId[id]]] : []));
}
