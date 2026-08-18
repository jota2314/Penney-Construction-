import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken } from "./auth";
import { fetchBills, fetchPayments, fetchVendors, fetchPurchases, qbQuery } from "./client";
import type { QBBill, QBPayment, QBVendor, QBPurchase } from "./client";
import { resolveSubcontractorId } from "@/lib/subs/resolve-subcontractor";

interface SyncResult {
  vendors: { synced: number; skipped: number };
  bills: { synced: number; skipped: number };
  payments: { synced: number; skipped: number };
  purchases: { synced: number; skipped: number };
  errors: string[];
}

/** Main sync: pull all QB data into Supabase tables */
export async function syncQuickBooks(): Promise<SyncResult> {
  const { accessToken, realmId, environment } = await getValidAccessToken();
  const supabase = await createClient();

  // In sandbox mode, only records coded to a known project are imported —
  // otherwise the sandbox's fake vendors/bills would pollute real financials.
  const sandboxOnlyMatched = environment === "sandbox";

  const result: SyncResult = {
    vendors: { synced: 0, skipped: 0 },
    bills: { synced: 0, skipped: 0 },
    payments: { synced: 0, skipped: 0 },
    purchases: { synced: 0, skipped: 0 },
    errors: [],
  };

  // QuickBooks Job Id → app project id. Expenses coded to a Job in QuickBooks
  // (the Customer/Project field on each line) land on that project's Spent.
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, quickbooks_customer_id")
    .not("quickbooks_customer_id", "is", null);
  const projectByQbId = new Map<string, string>(
    (projectRows ?? []).map((p) => [p.quickbooks_customer_id as string, p.id as string])
  );

  const projectForLines = (
    lines: Array<{ AccountBasedExpenseLineDetail?: { CustomerRef?: { value: string } }; ItemBasedExpenseLineDetail?: { CustomerRef?: { value: string } } }>
  ): string | null => {
    for (const line of lines) {
      const ref = line.AccountBasedExpenseLineDetail?.CustomerRef?.value
        || line.ItemBasedExpenseLineDetail?.CustomerRef?.value;
      if (ref && projectByQbId.has(ref)) return projectByQbId.get(ref)!;
    }
    return null;
  };

  // 1. Sync vendors → subcontractors (skipped in sandbox: fake vendors)
  if (!sandboxOnlyMatched) {
    try {
      const vendors = await fetchVendors(realmId, accessToken, environment);
      for (const v of vendors) {
        const res = await syncVendor(supabase, v);
        if (res) result.vendors.synced++;
        else result.vendors.skipped++;
      }
    } catch (e) {
      result.errors.push(`Vendors: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. Sync bills → invoices (what subs/vendors charge Penney)
  try {
    const bills = await fetchBills(realmId, accessToken, environment);
    for (const b of bills) {
      const projectId = projectForLines(b.Line);
      if (sandboxOnlyMatched && !projectId) { result.bills.skipped++; continue; }
      const res = await syncBill(supabase, b, projectId);
      if (res) result.bills.synced++;
      else result.bills.skipped++;
    }
  } catch (e) {
    result.errors.push(`Bills: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Sync purchases/expenses → invoices
  try {
    const purchases = await fetchPurchases(realmId, accessToken, environment);
    for (const p of purchases) {
      const projectId = projectForLines(p.Line);
      if (sandboxOnlyMatched && !projectId) { result.purchases.skipped++; continue; }
      const res = await syncPurchase(supabase, p, projectId);
      if (res) result.purchases.synced++;
      else result.purchases.skipped++;
    }
  } catch (e) {
    result.errors.push(`Purchases: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. Sync client payments → payments_received
  try {
    const payments = await fetchPayments(realmId, accessToken, environment);
    for (const p of payments) {
      const projectId = p.CustomerRef?.value
        ? projectByQbId.get(p.CustomerRef.value) || null
        : null;
      if (sandboxOnlyMatched && !projectId) { result.payments.skipped++; continue; }
      const res = await syncPayment(supabase, p, projectId);
      if (res) result.payments.synced++;
      else result.payments.skipped++;
    }
  } catch (e) {
    result.errors.push(`Payments: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Update last sync timestamp
  await supabase
    .from("app_settings")
    .update({ value: new Date().toISOString() })
    .eq("key", "quickbooks_last_sync");

  return result;
}

/* ── Webhook-driven incremental sync ─────────────────────────────────────────
   Called by /api/quickbooks/webhook when Intuit notifies us of changes.
   Runs with the admin client — webhooks arrive with no user session. */

export interface ChangedEntity {
  name: string; // "Bill" | "Purchase" | "Payment" | ...
  id: string;
}

export async function syncChangedEntities(entities: ChangedEntity[]): Promise<{
  synced: number;
  skipped: number;
  errors: string[];
}> {
  const { accessToken, realmId, environment } = await getValidAccessToken();
  const supabase = createAdminClient();
  const sandboxOnlyMatched = environment === "sandbox";

  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, quickbooks_customer_id")
    .not("quickbooks_customer_id", "is", null);
  const projectByQbId = new Map<string, string>(
    (projectRows ?? []).map((p) => [p.quickbooks_customer_id as string, p.id as string])
  );

  const projectForLines = (
    lines: Array<{ AccountBasedExpenseLineDetail?: { CustomerRef?: { value: string } }; ItemBasedExpenseLineDetail?: { CustomerRef?: { value: string } } }>
  ): string | null => {
    for (const line of lines) {
      const ref = line.AccountBasedExpenseLineDetail?.CustomerRef?.value
        || line.ItemBasedExpenseLineDetail?.CustomerRef?.value;
      if (ref && projectByQbId.has(ref)) return projectByQbId.get(ref)!;
    }
    return null;
  };

  const result = { synced: 0, skipped: 0, errors: [] as string[] };

  for (const entity of entities) {
    try {
      if (entity.name === "Bill") {
        const [bill] = await qbQuery<QBBill>(realmId, accessToken, `SELECT * FROM Bill WHERE Id = '${entity.id}'`, environment);
        if (!bill) { result.skipped++; continue; }
        const projectId = projectForLines(bill.Line);
        if (sandboxOnlyMatched && !projectId) { result.skipped++; continue; }
        (await syncBill(supabase, bill, projectId)) ? result.synced++ : result.skipped++;
      } else if (entity.name === "Purchase") {
        const [purchase] = await qbQuery<QBPurchase>(realmId, accessToken, `SELECT * FROM Purchase WHERE Id = '${entity.id}'`, environment);
        if (!purchase) { result.skipped++; continue; }
        const projectId = projectForLines(purchase.Line);
        if (sandboxOnlyMatched && !projectId) { result.skipped++; continue; }
        (await syncPurchase(supabase, purchase, projectId)) ? result.synced++ : result.skipped++;
      } else if (entity.name === "Payment") {
        const [payment] = await qbQuery<QBPayment>(realmId, accessToken, `SELECT * FROM Payment WHERE Id = '${entity.id}'`, environment);
        if (!payment) { result.skipped++; continue; }
        const projectId = payment.CustomerRef?.value
          ? projectByQbId.get(payment.CustomerRef.value) || null
          : null;
        if (sandboxOnlyMatched && !projectId) { result.skipped++; continue; }
        (await syncPayment(supabase, payment, projectId)) ? result.synced++ : result.skipped++;
      } else if (entity.name === "Vendor" && !sandboxOnlyMatched) {
        const [vendor] = await qbQuery<QBVendor>(realmId, accessToken, `SELECT * FROM Vendor WHERE Id = '${entity.id}'`, environment);
        if (!vendor) { result.skipped++; continue; }
        (await syncVendor(supabase, vendor)) ? result.synced++ : result.skipped++;
      } else {
        result.skipped++;
      }
    } catch (e) {
      result.errors.push(`${entity.name} ${entity.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

/* ── Individual sync functions ── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncVendor(supabase: any, vendor: QBVendor): Promise<boolean> {
  const qbId = `qb_${vendor.Id}`;

  // Check if already exists
  const { data: existing } = await supabase
    .from("subcontractors")
    .select("id")
    .eq("quickbooks_id", qbId)
    .maybeSingle();

  const vendorData = {
    company_name: vendor.DisplayName || vendor.CompanyName || "Unknown",
    contact_name: vendor.DisplayName || "",
    email: vendor.PrimaryEmailAddr?.Address || null,
    phone: vendor.PrimaryPhone?.FreeFormNumber || null,
    quickbooks_id: qbId,
    is_active: true,
  };

  if (existing) {
    // Update existing
    await supabase.from("subcontractors").update(vendorData).eq("id", existing.id);
    return false; // skipped (updated)
  }

  // Insert new
  const { error } = await supabase.from("subcontractors").insert(vendorData);
  if (error) return false;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncBill(supabase: any, bill: QBBill, projectId: string | null = null): Promise<boolean> {
  const qbId = `qb_bill_${bill.Id}`;

  const { data: existing } = await supabase
    .from("invoices")
    .select("id, source")
    .eq("quickbooks_id", qbId)
    .maybeSingle();

  // A row the APP pushed to QBO (field capture, receipt scan) already carries
  // the right job, budget line, and — on splits — a partial amount. Rewriting
  // it from the QBO copy would clobber the allocation and restate a split
  // child at the full receipt total.
  if (existing && existing.source !== "quickbooks") return false;

  const isPaid = bill.Balance === 0;
  const vendorName = bill.VendorRef?.name || "Unknown Vendor";

  // Try to guess trade from line item descriptions or account names
  const trade = guessTradeFromBill(bill);

  const invoiceData: Record<string, unknown> = {
    vendor_name: vendorName,
    amount: bill.TotalAmt,
    paid_amount: bill.TotalAmt - bill.Balance,
    payment_status: isPaid ? "paid" : bill.Balance < bill.TotalAmt ? "partial" : "unpaid",
    invoice_date: bill.TxnDate,
    due_date: bill.DueDate || null,
    trade,
    project_id: projectId,
    source: "quickbooks",
    quickbooks_id: qbId,
    notes: bill.PrivateNote || null,
  };
  // Only set when resolved — an update must never null out a manual link.
  const billSubId = await resolveSubcontractorId(supabase, vendorName);
  if (billSubId) invoiceData.subcontractor_id = billSubId;

  if (existing) {
    await supabase.from("invoices").update(invoiceData).eq("id", existing.id);
    return false;
  }

  const { error } = await supabase.from("invoices").insert(invoiceData);
  if (error) return false;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncPurchase(supabase: any, purchase: QBPurchase, projectId: string | null = null): Promise<boolean> {
  const qbId = `qb_purchase_${purchase.Id}`;

  const { data: existing } = await supabase
    .from("invoices")
    .select("id, source")
    .eq("quickbooks_id", qbId)
    .maybeSingle();

  // Same guard as syncBill: never let the QBO copy overwrite a row the app
  // itself pushed — it would null the job/budget-line coding the capture set.
  if (existing && existing.source !== "quickbooks") return false;

  const vendorName = purchase.EntityRef?.name || purchase.AccountRef?.name || "Direct Purchase";

  const invoiceData: Record<string, unknown> = {
    vendor_name: vendorName,
    amount: purchase.TotalAmt,
    paid_amount: purchase.TotalAmt, // purchases are paid immediately
    payment_status: "paid" as const,
    invoice_date: purchase.TxnDate,
    trade: guessTradeFromPurchase(purchase),
    project_id: projectId,
    source: "quickbooks",
    quickbooks_id: qbId,
    notes: purchase.PrivateNote || null,
  };
  const purchaseSubId = await resolveSubcontractorId(supabase, vendorName);
  if (purchaseSubId) invoiceData.subcontractor_id = purchaseSubId;

  if (existing) {
    await supabase.from("invoices").update(invoiceData).eq("id", existing.id);
    return false;
  }

  const { error } = await supabase.from("invoices").insert(invoiceData);
  if (error) return false;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncPayment(supabase: any, payment: QBPayment, projectId: string | null = null): Promise<boolean> {
  const qbId = `qb_payment_${payment.Id}`;

  const { data: existing } = await supabase
    .from("payments_received")
    .select("id")
    .eq("quickbooks_id", qbId)
    .maybeSingle();

  const paymentData = {
    amount: payment.TotalAmt,
    received_date: payment.TxnDate,
    payment_type: payment.PaymentMethodRef?.name || "check",
    project_id: projectId,
    source: "quickbooks",
    quickbooks_id: qbId,
    notes: payment.PrivateNote || `From ${payment.CustomerRef?.name || "client"}`,
  };

  if (existing) {
    await supabase.from("payments_received").update(paymentData).eq("id", existing.id);
    return false;
  }

  const { error } = await supabase.from("payments_received").insert(paymentData);
  if (error) return false;
  return true;
}

/* ── Trade guessing helpers ── */

const TRADE_KEYWORDS: Record<string, string[]> = {
  electrical: ["electric", "wiring", "panel", "breaker"],
  plumbing: ["plumb", "pipe", "drain", "water", "sewer", "fixture"],
  hvac: ["hvac", "heating", "cooling", "furnace", "duct", "ac ", "a/c"],
  carpentry: ["carpent", "framing", "lumber", "wood", "trim", "cabinet"],
  roofing: ["roof", "shingle", "gutter", "flash"],
  painting: ["paint", "primer", "stain"],
  flooring: ["floor", "tile", "hardwood", "carpet", "vinyl"],
  masonry: ["mason", "brick", "stone", "concrete", "foundation"],
  insulation: ["insul", "spray foam", "fiberglass"],
  drywall: ["drywall", "sheetrock", "plaster"],
  demolition: ["demo", "demolition", "tear down"],
  landscaping: ["landscape", "lawn", "tree", "garden"],
  windows: ["window", "glass", "glazing", "door"],
};

function guessTradeFromBill(bill: QBBill): string | null {
  const searchText = [
    bill.VendorRef?.name,
    bill.PrivateNote,
    ...bill.Line.map((l) => l.Description),
    ...bill.Line.map((l) => l.AccountBasedExpenseLineDetail?.AccountRef?.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return matchTrade(searchText);
}

function guessTradeFromPurchase(purchase: QBPurchase): string | null {
  const searchText = [
    purchase.EntityRef?.name,
    purchase.AccountRef?.name,
    purchase.PrivateNote,
    ...purchase.Line.map((l) => l.Description),
    ...purchase.Line.map((l) => l.AccountBasedExpenseLineDetail?.AccountRef?.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return matchTrade(searchText);
}

function matchTrade(text: string): string | null {
  for (const [trade, keywords] of Object.entries(TRADE_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) return trade;
  }
  return null;
}
