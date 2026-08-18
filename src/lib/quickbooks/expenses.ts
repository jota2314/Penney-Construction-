import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken, isQuickBooksConnected } from "./auth";
import { qbQuery, qbPost } from "./client";
import { pushProjectToQuickBooks } from "./customers";

/**
 * Vendor invoices → QuickBooks expenses.
 *
 * When a receipt or bill is filed as PAID in the app (field capture, review
 * queue), mirror it into QBO as a Purchase so Nicole never hand-types it:
 *   - paid by card  → Purchase (PaymentType CreditCard) drawn on the FILER's
 *     own Capital One subaccount (QBO has one per cardholder)
 *   - paid by check/cash → Purchase drawn on the checking account
 * Each budget-line allocation becomes its own expense line, coded to the
 * chart-of-accounts bucket its category implies (gas → Fuel Expense, permits
 * → Permits & Fees, materials → Construction Materials Costs, …), with the
 * QBO Job attached so job costing works. Overhead (is_overhead project)
 * carries no Job.
 *
 * The QB sync (sync.ts) imports QBO Purchases back into `invoices` keyed by
 * quickbooks_id = qb_purchase_<Id>. We stamp that key on ONE row per Purchase
 * so a later sync matches instead of duplicating the receipt as new spend.
 * Unpaid vendor bills are deliberately NOT pushed — A/P entry stays a human
 * decision in QBO, same as the standing invoice-push policy.
 */

interface QBAccount {
  Id: string;
  Name: string;
  FullyQualifiedName: string;
  AccountType: string;
}

interface QBVendorRow {
  Id: string;
  DisplayName: string;
}

interface QBPurchaseCreated {
  Id: string;
}

const CARD_PARENT_NAME = "Capital One Credit Card";

/** App profile names that differ from the QBO card subaccount names. */
const CARDHOLDER_ALIASES: Record<string, string> = {
  "howie clickstein": "howard clickstein",
};

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Category → QBO account, matched off the budget line's description first,
 * then the invoice trade. Overhead lines are the 14 spend categories on
 * PC-2026-179; job lines are trades. Fall through to the last entry.
 */
const OVERHEAD_ACCOUNT_RULES: Array<[RegExp, string]> = [
  [/fuel|gas/i, "Fuel Expense"],
  [/vehicle|truck|auto/i, "Auto and Truck Expenses"],
  [/insurance/i, "Insurance Expense"],
  [/tool|small equip/i, "Tools and Small Equipment"],
  [/software|subscription/i, "Software & Subscriptions"],
  [/phone|internet|utilit|rent/i, "Utilities"],
  [/payroll/i, "Payroll Salary & Wages"],
  [/professional|legal|account/i, "Legal & Accounting"],
  [/license|permit|dues/i, "Licenses and Permits"],
  [/marketing|advertis/i, "Advertising"],
  [/bank|merchant/i, "Bank Service Charges"],
  [/meal/i, "Meals and Entertainment"],
  [/./, "Office Expense"],
];

const JOB_ACCOUNT_RULES: Array<[RegExp, string]> = [
  [/permit/i, "Permits & Fees"],
  [/dumpster|waste|disposal|dump fee|porta|toilet|protection|cleanup|clean-up/i, "Other Construction Costs"],
  [/tool|equipment rental|rental/i, "Tools and Small Equipment"],
  [/fuel|gas station/i, "Fuel Expense"],
  [/./, "Construction Materials Costs"],
];

function accountNameFor(category: string, isOverhead: boolean): string {
  const rules = isOverhead ? OVERHEAD_ACCOUNT_RULES : JOB_ACCOUNT_RULES;
  for (const [pattern, account] of rules) {
    if (pattern.test(category)) return account;
  }
  return isOverhead ? "Office Expense" : "Construction Materials Costs";
}

function findAccount(accounts: QBAccount[], name: string): QBAccount | null {
  const target = norm(name);
  return accounts.find((a) => norm(a.Name) === target) ?? null;
}

/**
 * The card subaccount for whoever filed the receipt. QBO names them after the
 * cardholder ("Capital One Credit Card:RYAN PENNEY"). No match → the parent
 * card account, which Nicole can recategorize when she reconciles the feed.
 */
function findCardAccount(accounts: QBAccount[], filerName: string | null): QBAccount | null {
  const cards = accounts.filter(
    (a) =>
      a.AccountType === "Credit Card" &&
      norm(a.FullyQualifiedName).startsWith(norm(CARD_PARENT_NAME)),
  );
  if (filerName) {
    const wanted = CARDHOLDER_ALIASES[norm(filerName)] ?? norm(filerName);
    const match = cards.find((a) => norm(a.Name) === wanted);
    if (match) return match;
  }
  return cards.find((a) => norm(a.Name) === norm(CARD_PARENT_NAME)) ?? cards[0] ?? null;
}

async function ensureVendor(
  realmId: string,
  accessToken: string,
  environment: "production" | "sandbox",
  vendorName: string,
): Promise<string> {
  const safeName = vendorName.replace(/'/g, "\\'").slice(0, 100);
  const existing = await qbQuery<QBVendorRow>(
    realmId,
    accessToken,
    `SELECT Id, DisplayName FROM Vendor WHERE DisplayName = '${safeName}'`,
    environment,
  );
  if (existing[0]) return existing[0].Id;

  try {
    const created = await qbPost<QBVendorRow>(realmId, accessToken, "Vendor", {
      DisplayName: vendorName.slice(0, 100),
    }, environment);
    return created.Id;
  } catch (err) {
    // DisplayName is unique across vendors AND customers/employees in QBO.
    // A supplier that is also a customer needs a distinct vendor name.
    if (err instanceof Error && /Duplicate Name|6240/i.test(err.message)) {
      const created = await qbPost<QBVendorRow>(realmId, accessToken, "Vendor", {
        DisplayName: `${vendorName.slice(0, 90)} (Vendor)`,
      }, environment);
      return created.Id;
    }
    throw err;
  }
}

type InvoiceRow = {
  id: string;
  project_id: string | null;
  vendor_name: string;
  amount: number;
  invoice_date: string | null;
  description: string | null;
  trade: string | null;
  payment_status: string | null;
  payment_method: string | null;
  quickbooks_id: string | null;
  quickbooks_purchase_id: string | null;
  created_by: string | null;
  estimate_line_items: { description: string | null; trade: string | null } | { description: string | null; trade: string | null }[] | null;
  projects: { id: string; is_overhead: boolean | null; quickbooks_customer_id: string | null } | { id: string; is_overhead: boolean | null; quickbooks_customer_id: string | null }[] | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/**
 * Mirror one filed receipt into QBO as a single Purchase. Pass every invoice
 * row the receipt produced (a split files one row per budget line) — they
 * become the Purchase's expense lines. Idempotent: already-pushed rows are
 * left alone. Never throws; the error lands on quickbooks_push_error so a
 * QBO hiccup can't break the filing.
 */
export async function pushVendorExpenseToQuickBooks(
  invoiceIds: string[],
): Promise<{ error: string | null; qbPurchaseId?: string }> {
  const supabase = createAdminClient();

  const recordError = async (message: string) => {
    await supabase
      .from("invoices")
      .update({ quickbooks_push_error: message.slice(0, 500) })
      .in("id", invoiceIds);
  };

  try {
    if (invoiceIds.length === 0) return { error: "No invoices to push" };
    if (!(await isQuickBooksConnected())) return { error: "QuickBooks not connected" };

    const { data, error: loadErr } = await supabase
      .from("invoices")
      .select(
        "id, project_id, vendor_name, amount, invoice_date, description, trade, payment_status, payment_method, quickbooks_id, quickbooks_purchase_id, created_by, estimate_line_items(description, trade), projects(id, is_overhead, quickbooks_customer_id)",
      )
      .in("id", invoiceIds);
    if (loadErr || !data || data.length === 0) {
      return { error: loadErr?.message || "Invoices not found" };
    }
    const rows = data as unknown as InvoiceRow[];

    const already = rows.find((r) => r.quickbooks_purchase_id || r.quickbooks_id);
    if (already) {
      return { error: null, qbPurchaseId: already.quickbooks_purchase_id ?? undefined };
    }

    if (rows.some((r) => r.payment_status !== "paid")) {
      // Unpaid bills belong in A/P by a human's hand, not an auto Purchase.
      return { error: null };
    }

    const method = rows[0].payment_method ?? "credit_card";
    const paymentType =
      method === "credit_card" ? "CreditCard" : method === "cash" ? "Cash" : "Check";

    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (total <= 0) return { error: null };

    const project = one(rows[0].projects);
    const isOverhead = Boolean(project?.is_overhead);

    // Job costing: the Purchase lines carry the QBO Job. Overhead carries none.
    let qbJobId: string | null = null;
    if (project && !isOverhead) {
      qbJobId = project.quickbooks_customer_id;
      if (!qbJobId) {
        const pushed = await pushProjectToQuickBooks(project.id);
        if (pushed.error || !pushed.qbJobId) {
          const msg = `Could not create the QBO job: ${pushed.error ?? "unknown"}`;
          await recordError(msg);
          return { error: msg };
        }
        qbJobId = pushed.qbJobId;
      }
    }

    const { accessToken, realmId, environment } = await getValidAccessToken();

    const accounts = await qbQuery<QBAccount>(
      realmId,
      accessToken,
      "SELECT Id, Name, FullyQualifiedName, AccountType FROM Account WHERE Active = true MAXRESULTS 1000",
      environment,
    );

    // Payment side: the filer's card subaccount, or the checking account.
    let paymentAccount: QBAccount | null;
    if (paymentType === "CreditCard") {
      let filerName: string | null = null;
      if (rows[0].created_by) {
        const { data: filer } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", rows[0].created_by)
          .maybeSingle();
        filerName = filer?.full_name ?? null;
      }
      paymentAccount = findCardAccount(accounts, filerName);
    } else {
      paymentAccount = accounts.find((a) => a.AccountType === "Bank") ?? null;
    }
    if (!paymentAccount) {
      const msg = `No QBO ${paymentType === "CreditCard" ? "credit card" : "bank"} account found to pay from`;
      await recordError(msg);
      return { error: msg };
    }

    const vendorId = await ensureVendor(realmId, accessToken, environment, rows[0].vendor_name);

    const lines = rows.map((r) => {
      const line = one(r.estimate_line_items);
      const category = line?.description || r.trade || r.description || "";
      const account = findAccount(accounts, accountNameFor(category, isOverhead));
      return {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: Number(r.amount) || 0,
        Description: [line?.description, r.description].filter(Boolean).join(" — ").slice(0, 4000) || r.vendor_name,
        AccountBasedExpenseLineDetail: {
          // The account list came straight from QBO, so a miss means the
          // chart changed — fall back to the first expense-side account
          // rather than dropping the line.
          AccountRef: {
            value: (account ?? accounts.find((a) => a.AccountType === "Cost of Goods Sold" || a.AccountType === "Expense"))!.Id,
          },
          ...(qbJobId ? { CustomerRef: { value: qbJobId } } : {}),
        },
      };
    });

    const created = await qbPost<QBPurchaseCreated>(realmId, accessToken, "Purchase", {
      PaymentType: paymentType,
      AccountRef: { value: paymentAccount.Id },
      EntityRef: { value: vendorId, type: "Vendor" },
      TxnDate: rows[0].invoice_date ?? undefined,
      PrivateNote: `Penney app receipt ${rows[0].id} — auto-filed`,
      Line: lines,
    }, environment);

    const now = new Date().toISOString();
    await supabase
      .from("invoices")
      .update({ quickbooks_purchase_id: created.Id, quickbooks_pushed_at: now, quickbooks_push_error: null })
      .in("id", invoiceIds);
    // The sync dedup key goes on exactly ONE row — its lookup is a
    // maybeSingle(), which errors out if two rows ever share the key.
    await supabase
      .from("invoices")
      .update({ quickbooks_id: `qb_purchase_${created.Id}` })
      .eq("id", rows[0].id);

    return { error: null, qbPurchaseId: created.Id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await recordError(message);
    } catch {
      // recording the error is best-effort — the original failure matters more
    }
    return { error: message };
  }
}
