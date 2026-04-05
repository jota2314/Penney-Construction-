import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "./auth";
import { fetchBills, fetchPayments, fetchVendors, fetchPurchases } from "./client";
import type { QBBill, QBPayment, QBVendor, QBPurchase } from "./client";

interface SyncResult {
  vendors: { synced: number; skipped: number };
  bills: { synced: number; skipped: number };
  payments: { synced: number; skipped: number };
  purchases: { synced: number; skipped: number };
  errors: string[];
}

/** Main sync: pull all QB data into Supabase tables */
export async function syncQuickBooks(): Promise<SyncResult> {
  const { accessToken, realmId } = await getValidAccessToken();
  const supabase = await createClient();

  const result: SyncResult = {
    vendors: { synced: 0, skipped: 0 },
    bills: { synced: 0, skipped: 0 },
    payments: { synced: 0, skipped: 0 },
    purchases: { synced: 0, skipped: 0 },
    errors: [],
  };

  // 1. Sync vendors → subcontractors
  try {
    const vendors = await fetchVendors(realmId, accessToken);
    for (const v of vendors) {
      const res = await syncVendor(supabase, v);
      if (res) result.vendors.synced++;
      else result.vendors.skipped++;
    }
  } catch (e) {
    result.errors.push(`Vendors: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Sync bills → invoices (what subs/vendors charge Penney)
  try {
    const bills = await fetchBills(realmId, accessToken);
    for (const b of bills) {
      const res = await syncBill(supabase, b);
      if (res) result.bills.synced++;
      else result.bills.skipped++;
    }
  } catch (e) {
    result.errors.push(`Bills: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Sync purchases/expenses → invoices
  try {
    const purchases = await fetchPurchases(realmId, accessToken);
    for (const p of purchases) {
      const res = await syncPurchase(supabase, p);
      if (res) result.purchases.synced++;
      else result.purchases.skipped++;
    }
  } catch (e) {
    result.errors.push(`Purchases: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. Sync client payments → payments_received
  try {
    const payments = await fetchPayments(realmId, accessToken);
    for (const p of payments) {
      const res = await syncPayment(supabase, p);
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
async function syncBill(supabase: any, bill: QBBill): Promise<boolean> {
  const qbId = `qb_bill_${bill.Id}`;

  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("quickbooks_id", qbId)
    .maybeSingle();

  const isPaid = bill.Balance === 0;
  const vendorName = bill.VendorRef?.name || "Unknown Vendor";

  // Try to guess trade from line item descriptions or account names
  const trade = guessTradeFromBill(bill);

  const invoiceData = {
    vendor_name: vendorName,
    amount: bill.TotalAmt,
    paid_amount: bill.TotalAmt - bill.Balance,
    payment_status: isPaid ? "paid" : bill.Balance < bill.TotalAmt ? "partial" : "pending",
    invoice_date: bill.TxnDate,
    due_date: bill.DueDate || null,
    trade,
    source: "quickbooks",
    quickbooks_id: qbId,
    notes: bill.PrivateNote || null,
  };

  if (existing) {
    await supabase.from("invoices").update(invoiceData).eq("id", existing.id);
    return false;
  }

  const { error } = await supabase.from("invoices").insert(invoiceData);
  if (error) return false;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncPurchase(supabase: any, purchase: QBPurchase): Promise<boolean> {
  const qbId = `qb_purchase_${purchase.Id}`;

  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("quickbooks_id", qbId)
    .maybeSingle();

  const vendorName = purchase.EntityRef?.name || purchase.AccountRef?.name || "Direct Purchase";

  const invoiceData = {
    vendor_name: vendorName,
    amount: purchase.TotalAmt,
    paid_amount: purchase.TotalAmt, // purchases are paid immediately
    payment_status: "paid" as const,
    invoice_date: purchase.TxnDate,
    trade: guessTradeFromPurchase(purchase),
    source: "quickbooks",
    quickbooks_id: qbId,
    notes: purchase.PrivateNote || null,
  };

  if (existing) {
    await supabase.from("invoices").update(invoiceData).eq("id", existing.id);
    return false;
  }

  const { error } = await supabase.from("invoices").insert(invoiceData);
  if (error) return false;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncPayment(supabase: any, payment: QBPayment): Promise<boolean> {
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
