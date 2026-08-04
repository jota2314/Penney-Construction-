import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken, isQuickBooksConnected } from "./auth";
import { qbQuery, qbPost, type QBEnvironment } from "./client";
import { pushProjectToQuickBooks } from "./customers";

interface QBItem {
  Id: string;
  Name: string;
}

interface QBInvoice {
  Id: string;
  DocNumber?: string;
}

// "Const. Draw" is the Item every real Penney client invoice bills under
// (Nicole's convention in QBO) — reuse it so app-pushed invoices land in the
// same income bucket instead of a parallel auto-created item.
const SERVICE_ITEM_NAME = "Const. Draw";

/**
 * Find or create the generic service Item that client-invoice lines bill
 * against. QuickBooks requires every sales line to reference an Item.
 */
async function ensureServiceItem(
  realmId: string,
  accessToken: string,
  environment: QBEnvironment
): Promise<string> {
  const existing = await qbQuery<QBItem>(
    realmId,
    accessToken,
    `SELECT Id, Name FROM Item WHERE Name = '${SERVICE_ITEM_NAME}'`,
    environment
  );
  if (existing[0]) return existing[0].Id;

  const incomeAccounts = await qbQuery<{ Id: string }>(
    realmId,
    accessToken,
    "SELECT Id FROM Account WHERE AccountType = 'Income' MAXRESULTS 1",
    environment
  );
  if (!incomeAccounts[0]) {
    throw new Error("No income account found in QuickBooks to attach the service item to");
  }

  const created = await qbPost<QBItem>(realmId, accessToken, "Item", {
    Name: SERVICE_ITEM_NAME,
    Type: "Service",
    IncomeAccountRef: { value: incomeAccounts[0].Id },
  }, environment);
  return created.Id;
}

/**
 * Mirror an app client invoice (money the client owes Penney) into QuickBooks
 * as an Invoice on the project's Job. Idempotent — returns the existing
 * QuickBooks Id if the invoice was already pushed.
 */
export async function pushClientInvoiceToQuickBooks(
  clientInvoiceId: string
): Promise<{ error: string | null; qbInvoiceId?: string; qbDocNumber?: string }> {
  if (!(await isQuickBooksConnected())) {
    return { error: "QuickBooks not connected" };
  }

  const supabase = createAdminClient();

  const { data: invoice, error: invErr } = await supabase
    .from("client_invoices")
    .select("id, project_id, invoice_number, title, description, line_items, amount, due_date, quickbooks_invoice_id, projects(project_number)")
    .eq("id", clientInvoiceId)
    .single();

  if (invErr || !invoice) return { error: invErr?.message || "Client invoice not found" };
  if (invoice.quickbooks_invoice_id) {
    return { error: null, qbInvoiceId: invoice.quickbooks_invoice_id };
  }

  // Make sure the project exists in QuickBooks as a Job first.
  const projectPush = await pushProjectToQuickBooks(invoice.project_id);
  if (projectPush.error || !projectPush.qbJobId) {
    return { error: projectPush.error || "Project has no QuickBooks Job" };
  }

  const { accessToken, realmId, environment } = await getValidAccessToken();
  const itemId = await ensureServiceItem(realmId, accessToken, environment);

  const lineItems: Array<{ description: string; amount: number }> = Array.isArray(invoice.line_items)
    ? invoice.line_items
    : [];
  const lines = (lineItems.length > 0
    ? lineItems
    : [{ description: invoice.title, amount: Number(invoice.amount) || 0 }]
  ).map((li) => ({
    DetailType: "SalesItemLineDetail",
    Amount: Number(li.amount) || 0,
    Description: li.description,
    SalesItemLineDetail: { ItemRef: { value: itemId } },
  }));

  // The company uses custom transaction numbers, so QuickBooks leaves
  // API-created invoices blank unless we supply a DocNumber. Use
  // "{project number}-{per-project invoice #}" (e.g. PC-2026-181-1) — unique,
  // traceable, and can't collide with Nicole's hand-typed numeric sequence.
  // (projects() is a to-one join; supabase types it as an array)
  const project = Array.isArray(invoice.projects) ? invoice.projects[0] : invoice.projects;
  const docNumber = project?.project_number
    ? `${project.project_number}-${invoice.invoice_number}`.slice(0, 21)
    : undefined;

  const created = await qbPost<QBInvoice>(realmId, accessToken, "Invoice", {
    CustomerRef: { value: projectPush.qbJobId },
    DocNumber: docNumber,
    Line: lines,
    DueDate: invoice.due_date || undefined,
    PrivateNote: `Penney app invoice #${invoice.invoice_number} — ${invoice.title}`,
  }, environment);

  await supabase
    .from("client_invoices")
    .update({
      quickbooks_invoice_id: created.Id,
      quickbooks_doc_number: created.DocNumber || null,
    })
    .eq("id", invoice.id);

  return { error: null, qbInvoiceId: created.Id, qbDocNumber: created.DocNumber };
}
