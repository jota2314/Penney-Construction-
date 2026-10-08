import { createAdminClient } from "@/lib/supabase/admin";
import { accountNameFor } from "@/lib/finance/spend-category";
import { isBankLedgerSource } from "@/lib/finance/bank-sources";
import { getValidAccessToken, isQuickBooksConnected } from "./auth";
import { qbQuery, qbPost, type QBEnvironment } from "./client";
import { pushProjectToQuickBooks } from "./customers";
import { matchVendor, normalizeVendorName, type VendorCandidate } from "./vendor-match";

/**
 * Vendor invoices → QuickBooks expenses.
 *
 * When a receipt or bill is filed as PAID in the app (field capture, review
 * queue), mirror it into QBO as a Purchase so Nicole never hand-types it:
 *   - paid by card  → Purchase (PaymentType CreditCard) on the Capital One
 *     card account (a cardholder subaccount if QBO still has them)
 *   - paid by check/cash → Purchase drawn on the checking account
 * Each budget-line allocation becomes its own expense line, coded to the
 * chart-of-accounts bucket its category implies (gas → Fuel Expense, permits
 * → Permits & Fees, materials → Construction Materials Costs, …), with each
 * piece's own QBO Job attached so job costing works — a receipt split across
 * two jobs is still ONE Purchase with one line per job. Overhead carries no Job.
 *
 * The QB sync (sync.ts) imports QBO Purchases back into `invoices` keyed by
 * quickbooks_id = qb_purchase_<Id>. We stamp that key on ONE row per Purchase
 * so a later sync matches instead of duplicating the receipt as new spend.
 *
 * UNPAID bills mirror too (Jorge 8/19: they should hit QBO right away) —
 * pushVendorBillToQuickBooks creates a QBO Bill so A/P shows on the Bills
 * page and Nicole can pay from there. Once a row carries quickbooks_bill_id,
 * Mark-paid posts a BillPayment AGAINST that Bill instead of a standalone
 * Purchase — a Bill plus a Purchase would book the cost twice.
 *
 * Nothing gets into QuickBooks twice (Nicole, 10/8 L10):
 *   - bank/statement/ledger rows are never pushed — QBO already has that
 *     money from its bank feed
 *   - the same bill filed twice in the app (same vendor + invoice # + total)
 *     is pushed once; the second filing gets a note instead
 *   - a charge QBO already holds (Nicole added it from the bank feed, or an
 *     earlier app copy whose receipt was later deleted) is ADOPTED, not
 *     re-created
 *   - vendors are matched by name family (vendor-match.ts), not exact text
 */

interface QBAccount {
  Id: string;
  Name: string;
  FullyQualifiedName: string;
  AccountType: string;
}

interface QBVendorRow extends VendorCandidate {
  SyncToken?: string;
}

interface QBPurchaseCreated {
  Id: string;
}

interface QBExistingTxn {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  Balance?: number;
  Credit?: boolean;
  DocNumber?: string;
  AccountRef?: { value: string };
  EntityRef?: { value: string; name?: string };
  VendorRef?: { value: string; name?: string };
  Line?: Array<{
    AccountBasedExpenseLineDetail?: { CustomerRef?: { value: string } };
    ItemBasedExpenseLineDetail?: { CustomerRef?: { value: string } };
  }>;
}

/** App profile names that differ from the QBO card subaccount names. */
const CARDHOLDER_ALIASES: Record<string, string> = {
  "howie clickstein": "howard clickstein",
};

/** The note a second filing of an already-pushed bill gets instead of a push. */
const DUPLICATE_NOTE = "Not sent to QuickBooks";

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
const cents = (n: number) => Math.round(n * 100);
const invoiceKey = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function findAccount(accounts: QBAccount[], name: string): QBAccount | null {
  const target = norm(name);
  return accounts.find((a) => norm(a.Name) === target) ?? null;
}

/**
 * The card account to draw a card receipt on. QBO used to carry one
 * subaccount per cardholder ("Capital One Credit Card:RYAN PENNEY"); on 10/6
 * the books moved to a single "Capital One CC 9826" and every card push failed
 * with "No QBO credit card account found". So: the payer's own subaccount if
 * one still exists, else the Capital One card account, else the only card.
 */
function findCardAccount(accounts: QBAccount[], filerName: string | null): QBAccount | null {
  const cards = accounts.filter((a) => a.AccountType === "Credit Card");
  if (filerName) {
    const wanted = CARDHOLDER_ALIASES[norm(filerName)] ?? norm(filerName);
    const match = cards.find((a) => a.FullyQualifiedName.includes(":") && norm(a.Name) === wanted);
    if (match) return match;
  }
  const capitalOne = cards.filter((a) => norm(a.FullyQualifiedName).startsWith("capital one"));
  return (
    capitalOne.find((a) => !a.FullyQualifiedName.includes(":")) ??
    capitalOne[0] ??
    (cards.length === 1 ? cards[0] : null)
  );
}

/** "capital_one" is a card too — it used to fall through to the bank account. */
function paymentTypeFor(method: string | null): "CreditCard" | "Cash" | "Check" {
  const m = method ?? "credit_card";
  if (m === "credit_card" || m === "capital_one") return "CreditCard";
  if (m === "cash") return "Cash";
  return "Check";
}

let vendorCache: { realmId: string; at: number; vendors: QBVendorRow[] } | null = null;

async function loadVendors(
  realmId: string,
  accessToken: string,
  environment: QBEnvironment,
  fresh = false,
): Promise<QBVendorRow[]> {
  if (!fresh && vendorCache && vendorCache.realmId === realmId && Date.now() - vendorCache.at < 5 * 60 * 1000) {
    return vendorCache.vendors;
  }
  // Inactive ones too: a lookup that can't see them tries to re-create the
  // name, QBO refuses it as a duplicate, and we'd end up with "X (Vendor)".
  const vendors: QBVendorRow[] = [];
  for (let start = 1; ; start += 1000) {
    const page = await qbQuery<QBVendorRow>(
      realmId,
      accessToken,
      `SELECT Id, DisplayName, Active, SyncToken, MetaData FROM Vendor WHERE Active IN (true, false) STARTPOSITION ${start} MAXRESULTS 1000`,
      environment,
    );
    vendors.push(...page);
    if (page.length < 1000) break;
  }
  vendorCache = { realmId, at: Date.now(), vendors };
  return vendors;
}

async function ensureVendor(
  realmId: string,
  accessToken: string,
  environment: QBEnvironment,
  vendorName: string,
): Promise<string> {
  const activate = async (v: QBVendorRow) => {
    if (v.Active === false) {
      // QBO won't post to an inactive vendor — bring the existing one back
      // rather than minting a second record with the same name.
      await qbPost(realmId, accessToken, "Vendor", {
        Id: v.Id,
        SyncToken: v.SyncToken,
        sparse: true,
        Active: true,
      }, environment);
      v.Active = true;
    }
    return v.Id;
  };
  const lookup = async (fresh: boolean) => {
    const hit = matchVendor(vendorName, await loadVendors(realmId, accessToken, environment, fresh));
    return hit ? activate(hit.vendor as QBVendorRow) : null;
  };

  // The cached list can be minutes old — Nicole may have just added the
  // vendor. Only a fresh list that still has no match justifies creating one.
  const known = (await lookup(false)) ?? (await lookup(true));
  if (known) return known;

  const remember = (created: QBVendorRow) => {
    vendorCache?.vendors.push({ ...created, Active: true });
    return created.Id;
  };
  try {
    return remember(await qbPost<QBVendorRow>(realmId, accessToken, "Vendor", {
      DisplayName: vendorName.slice(0, 100),
    }, environment));
  } catch (err) {
    if (!(err instanceof Error && /Duplicate Name|6240/i.test(err.message))) throw err;
    // Someone created it a moment ago — use theirs.
    const raced = await lookup(true);
    if (raced) return raced;
    // DisplayName is unique across vendors AND customers/employees in QBO.
    // A supplier that is also a customer needs a distinct vendor name —
    // and matchVendor reads "X (Vendor)" as X, so it is reused next time.
    return remember(await qbPost<QBVendorRow>(realmId, accessToken, "Vendor", {
      DisplayName: `${vendorName.slice(0, 90)} (Vendor)`,
    }, environment));
  }
}

type InvoiceRow = {
  id: string;
  project_id: string | null;
  vendor_name: string;
  vendor_type: string | null;
  amount: number;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  description: string | null;
  trade: string | null;
  source: string | null;
  duplicate_of_id: string | null;
  split_group_id: string | null;
  payment_status: string | null;
  payment_method: string | null;
  quickbooks_id: string | null;
  quickbooks_purchase_id: string | null;
  quickbooks_bill_id: string | null;
  quickbooks_push_error: string | null;
  created_by: string | null;
  created_at: string | null;
  paid_by_profile_id: string | null;
  estimate_line_items: { description: string | null; trade: string | null } | { description: string | null; trade: string | null }[] | null;
  projects: { id: string; is_overhead: boolean | null; quickbooks_customer_id: string | null } | { id: string; is_overhead: boolean | null; quickbooks_customer_id: string | null }[] | null;
};

const INVOICE_COLUMNS =
  "id, project_id, vendor_name, vendor_type, amount, invoice_number, invoice_date, due_date, description, trade, source, duplicate_of_id, split_group_id, payment_status, payment_method, quickbooks_id, quickbooks_purchase_id, quickbooks_bill_id, quickbooks_push_error, created_by, created_at, paid_by_profile_id, estimate_line_items(description, trade), projects(id, is_overhead, quickbooks_customer_id)";

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/**
 * Rows that must never reach QuickBooks: bank/statement lines (QBO has them
 * from its bank feed), rows the QuickBooks sync imported (they ARE the QBO
 * record), internal labor allocations, and rows the office already marked as
 * a duplicate of another bill.
 */
const neverPush = (r: InvoiceRow) =>
  isBankLedgerSource(r.source) ||
  r.source === "quickbooks" ||
  r.payment_method === "internal" ||
  Boolean(r.duplicate_of_id);

/** Load the batch; rows that never push lose any stale error so the retry stops picking them. */
async function loadPushable(
  supabase: ReturnType<typeof createAdminClient>,
  invoiceIds: string[],
): Promise<{ rows: InvoiceRow[] | null; error?: string }> {
  const { data, error } = await supabase.from("invoices").select(INVOICE_COLUMNS).in("id", invoiceIds);
  if (error || !data || data.length === 0) return { rows: null, error: error?.message || "Invoices not found" };
  const all = data as unknown as InvoiceRow[];
  const stale = all.filter((r) => neverPush(r) && r.quickbooks_push_error).map((r) => r.id);
  if (stale.length > 0) await supabase.from("invoices").update({ quickbooks_push_error: null }).in("id", stale);
  return { rows: all.filter((r) => !neverPush(r)) };
}

/**
 * A receipt dated most of a year before it was filed is a misread year
 * ("2025-10-07" filed 10/7/26) — pushing it would post into last year's books.
 */
function implausibleDate(rows: InvoiceRow[]): string | null {
  const r = rows[0];
  if (!r.invoice_date || !r.created_at) return null;
  const gapDays = (new Date(r.created_at).getTime() - new Date(`${r.invoice_date}T00:00:00Z`).getTime()) / 864e5;
  if (gapDays < 270) return null;
  return `Held back from QuickBooks — the date ${r.invoice_date} looks wrong for something filed ${r.created_at.slice(0, 10)}. Fix the date and it will go on the next retry.`;
}

/** QBO Job per app project — every piece of a split carries its own job. */
async function jobIdsFor(rows: InvoiceRow[]): Promise<{ jobs: Map<string, string | null>; error?: string }> {
  const jobs = new Map<string, string | null>();
  for (const r of rows) {
    const project = one(r.projects);
    if (!project || jobs.has(project.id)) continue;
    if (project.is_overhead) {
      jobs.set(project.id, null);
      continue;
    }
    let qbJobId = project.quickbooks_customer_id;
    if (!qbJobId) {
      const pushed = await pushProjectToQuickBooks(project.id);
      if (pushed.error || !pushed.qbJobId) {
        return { jobs, error: `Could not create the QBO job: ${pushed.error ?? "unknown"}` };
      }
      qbJobId = pushed.qbJobId;
    }
    jobs.set(project.id, qbJobId);
  }
  return { jobs };
}

function expenseLines(rows: InvoiceRow[], accounts: QBAccount[], jobs: Map<string, string | null>) {
  return rows.map((r) => {
    const line = one(r.estimate_line_items);
    const project = one(r.projects);
    const isOverhead = Boolean(project?.is_overhead);
    const qbJobId = project ? jobs.get(project.id) ?? null : null;
    const category = line?.description || r.trade || r.description || "";
    const account = findAccount(accounts, accountNameFor(category, isOverhead, r.vendor_type, r.vendor_name, r.trade));
    return {
      DetailType: "AccountBasedExpenseLineDetail",
      // A credit (Credit: true / VendorCredit) carries positive lines — the
      // entity IS the sign.
      Amount: Math.abs(Number(r.amount) || 0),
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
}

const shiftDate = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 864e5).toISOString().slice(0, 10);

/**
 * Retire the sync's imported copy of a QBO transaction the receipt is about
 * to adopt: mark it a duplicate of the receipt (kept, not deleted, so any job
 * coding or bank match on it can still be looked up) and free the sync key.
 */
async function retireImported(
  supabase: ReturnType<typeof createAdminClient>,
  importedIds: string[],
  receiptId: string,
): Promise<void> {
  if (importedIds.length === 0) return;
  const { error } = await supabase
    .from("invoices")
    .update({ duplicate_of_id: receiptId, quickbooks_id: null })
    .in("id", importedIds)
    .eq("source", "quickbooks");
  if (error) throw new Error(`Could not retire the imported QuickBooks copy: ${error.message}`);
}

const daysApart = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 864e5;

/**
 * The same bill already went to QuickBooks from another app row — someone
 * filed it twice (Rest Stop #32396 by Ryan then Nicole; Building Center
 * #347841 twice by Bill). Same vendor family + same invoice # + same total,
 * or, for a bill or check with no invoice #, the same vendor + total + date +
 * job. Card receipts with no invoice # are left to the QBO-side check: two
 * identical fuel fills on one day are real.
 */
async function findPushedTwin(
  supabase: ReturnType<typeof createAdminClient>,
  rows: InvoiceRow[],
  total: number,
): Promise<string | null> {
  const first = rows[0];
  const inv = invoiceKey(first.invoice_number);
  const vendor = normalizeVendorName(first.vendor_name).replace(/ /g, "");
  if (!vendor) return null;
  const paidByCard = first.payment_status === "paid" && paymentTypeFor(first.payment_method) === "CreditCard";
  if (!inv && (paidByCard || !first.invoice_date)) return null;
  // Narrow by a word of the vendor's name; the exact family check is below.
  const word = first.vendor_name.split(/[^A-Za-z0-9]+/).find((w) => w.length >= 2 && !/^the$/i.test(w));
  if (!word) return null;
  const ids = new Set(rows.map((r) => r.id));
  const groups = new Set(rows.map((r) => r.split_group_id).filter(Boolean));

  let query = supabase
    .from("invoices")
    .select("id, vendor_name, invoice_number, amount, invoice_date, project_id, split_group_id, quickbooks_purchase_id, quickbooks_bill_id")
    .or("quickbooks_purchase_id.not.is.null,quickbooks_bill_id.not.is.null")
    .ilike("vendor_name", `%${word}%`)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (first.invoice_date) {
    query = query.gte("invoice_date", shiftDate(first.invoice_date, -60)).lte("invoice_date", shiftDate(first.invoice_date, 60));
  }
  const { data } = await query;

  const byTxn = new Map<string, NonNullable<typeof data>>();
  for (const r of data ?? []) {
    if (ids.has(r.id) || (r.split_group_id && groups.has(r.split_group_id))) continue;
    if (normalizeVendorName(r.vendor_name ?? "").replace(/ /g, "") !== vendor) continue;
    const key = r.quickbooks_purchase_id ? `Expense #${r.quickbooks_purchase_id}` : `Bill #${r.quickbooks_bill_id}`;
    byTxn.set(key, [...(byTxn.get(key) ?? []), r]);
  }
  for (const [label, txnRows] of byTxn) {
    const txnTotal = txnRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (cents(txnTotal) !== cents(total)) continue;
    const sameInvoice = inv && txnRows.some((r) => invoiceKey(r.invoice_number) === inv);
    const sameDayAndJob =
      !inv &&
      txnRows.some((r) => !invoiceKey(r.invoice_number) && r.invoice_date === first.invoice_date && r.project_id === first.project_id);
    if (sameInvoice || sameDayAndJob) {
      return `${DUPLICATE_NOTE} — same ${first.vendor_name}${first.invoice_number ? ` #${first.invoice_number}` : ""} for $${Math.abs(total).toFixed(2)} is already there as QuickBooks ${label}. If it really is a second bill, give it its own invoice number.`;
    }
  }
  return null;
}

/**
 * Who already points at these QBO transactions. A row filed in the app
 * blocks adoption. A row the QuickBooks sync imported (source 'quickbooks',
 * keyed only by quickbooks_id) is the same charge seen from the other side —
 * adopting replaces it, or the job would count the cost twice.
 */
async function claimsOn(
  supabase: ReturnType<typeof createAdminClient>,
  kind: "purchase" | "bill",
  candidates: string[],
): Promise<{ blocked: Set<string>; imported: Map<string, string[]> }> {
  const blocked = new Set<string>();
  const imported = new Map<string, string[]>();
  if (candidates.length === 0) return { blocked, imported };
  const column = kind === "purchase" ? "quickbooks_purchase_id" : "quickbooks_bill_id";
  const prefix = kind === "purchase" ? "qb_purchase_" : "qb_bill_";
  const columns = "id, source, quickbooks_id, quickbooks_purchase_id, quickbooks_bill_id";
  const [byColumn, byKey] = await Promise.all([
    supabase.from("invoices").select(columns).in(column, candidates),
    supabase.from("invoices").select(columns).in("quickbooks_id", candidates.map((id) => prefix + id)),
  ]);
  const failed = byColumn.error ?? byKey.error;
  if (failed) throw new Error(`Could not check existing QuickBooks links: ${failed.message}`);
  for (const r of byColumn.data ?? []) blocked.add(String(r[column]));
  for (const r of byKey.data ?? []) {
    const id = String(r.quickbooks_id).slice(prefix.length);
    if (r.source === "quickbooks") imported.set(id, [...(imported.get(id) ?? []), r.id]);
    else blocked.add(id);
  }
  return { blocked, imported };
}

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

  const recordError = async (message: string, ids: string[] = invoiceIds) => {
    await supabase
      .from("invoices")
      .update({ quickbooks_push_error: message.slice(0, 500) })
      .in("id", ids);
  };

  try {
    if (invoiceIds.length === 0) return { error: "No invoices to push" };
    if (!(await isQuickBooksConnected())) return { error: "QuickBooks not connected" };

    const { rows: loaded, error: loadErr } = await loadPushable(supabase, invoiceIds);
    if (!loaded) return { error: loadErr ?? "Invoices not found" };

    // A qb_bill_* / qb_vendorcredit_* sync key means "mirrored as a Bill",
    // not "expensed" — those rows fall through to the BillPayment branch.
    const isExpensed = (r: InvoiceRow) =>
      Boolean(r.quickbooks_purchase_id) ||
      Boolean(r.quickbooks_id && !r.quickbooks_id.startsWith("qb_bill_") && !r.quickbooks_id.startsWith("qb_vendorcredit_"));
    const rows = loaded.filter((r) => !isExpensed(r));
    if (rows.length === 0) {
      return { error: null, qbPurchaseId: loaded.find(isExpensed)?.quickbooks_purchase_id ?? undefined };
    }
    const ids = rows.map((r) => r.id);

    if (rows.some((r) => r.payment_status !== "paid")) {
      // Unpaid rows go through pushVendorBillToQuickBooks instead.
      return { error: null };
    }

    const paymentType = paymentTypeFor(rows[0].payment_method);

    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (total === 0) return { error: null };
    const isCredit = total < 0;

    const billId = rows[0].quickbooks_bill_id;
    // A credit already mirrored as a QBO VendorCredit needs no payment leg —
    // applying it against an open bill is Nicole's call inside QuickBooks.
    if (billId && isCredit) return { error: null };

    // A credit memo books negative in the app. QBO has no negative Purchase —
    // a refund is a Purchase with Credit: true carrying POSITIVE lines, and
    // that flag only exists on the card path. A cash or check refund has to
    // land as a deposit, which is Nicole's call, not an auto-push.
    if (isCredit && paymentType !== "CreditCard") {
      const msg =
        "credit refunded by check or cash — book the deposit in QuickBooks by hand, the app can't post it";
      await recordError(msg, ids);
      return { error: msg };
    }

    if (!billId) {
      const badDate = implausibleDate(rows);
      if (badDate) {
        await recordError(badDate, ids);
        return { error: badDate };
      }
      const twin = await findPushedTwin(supabase, rows, total);
      if (twin) {
        await recordError(twin, ids);
        return { error: twin };
      }
    }

    const { jobs, error: jobErr } = await jobIdsFor(rows);
    if (jobErr) {
      await recordError(jobErr, ids);
      return { error: jobErr };
    }

    const { accessToken, realmId, environment } = await getValidAccessToken();

    const accounts = await qbQuery<QBAccount>(
      realmId,
      accessToken,
      "SELECT Id, Name, FullyQualifiedName, AccountType FROM Account WHERE Active = true MAXRESULTS 1000",
      environment,
    );

    // Payment side: the card account, or the checking account.
    let paymentAccount: QBAccount | null;
    if (paymentType === "CreditCard") {
      // The payer's card, not the filer's — Nicole filing Ryan's bill must
      // draw on Ryan's subaccount. Field captures leave paid_by null (crew
      // pay their own) so created_by still decides there.
      const payerId = rows[0].paid_by_profile_id ?? rows[0].created_by;
      let filerName: string | null = null;
      if (payerId) {
        const { data: filer } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", payerId)
          .maybeSingle();
        filerName = filer?.full_name ?? null;
      }
      paymentAccount = findCardAccount(accounts, filerName);
    } else {
      paymentAccount = accounts.find((a) => a.AccountType === "Bank") ?? null;
    }
    if (!paymentAccount) {
      const msg = `No QBO ${paymentType === "CreditCard" ? "credit card" : "bank"} account found to pay from`;
      await recordError(msg, ids);
      return { error: msg };
    }

    const vendorId = await ensureVendor(realmId, accessToken, environment, rows[0].vendor_name);

    // Already mirrored as a QBO Bill → this payment PAYS that Bill. A
    // standalone Purchase on top of the Bill would book the cost twice.
    if (billId) {
      const [bill] = await qbQuery<QBExistingTxn>(
        realmId,
        accessToken,
        `SELECT Id, Balance, TotalAmt FROM Bill WHERE Id = '${billId}'`,
        environment,
      );
      // Nicole already paid it inside QuickBooks — nothing left to post.
      if (bill && Number(bill.Balance) === 0) {
        await supabase.from("invoices").update({ quickbooks_push_error: null }).in("id", ids);
        return { error: null };
      }
      // Part paid inside QuickBooks already → pay only what is still open.
      const due = bill ? Math.min(total, Number(bill.Balance)) : total;
      const payment = await qbPost<QBPurchaseCreated>(realmId, accessToken, "BillPayment", {
        VendorRef: { value: vendorId },
        PayType: paymentType === "CreditCard" ? "CreditCard" : "Check",
        ...(paymentType === "CreditCard"
          ? { CreditCardPayment: { CCAccountRef: { value: paymentAccount.Id } } }
          : { CheckPayment: { BankAccountRef: { value: paymentAccount.Id } } }),
        TotalAmt: due,
        Line: [{ Amount: due, LinkedTxn: [{ TxnId: billId, TxnType: "Bill" }] }],
        PrivateNote: `Penney app bill payment ${rows[0].id}`,
      }, environment);
      await supabase
        .from("invoices")
        .update({
          quickbooks_purchase_id: payment.Id,
          quickbooks_pushed_at: new Date().toISOString(),
          quickbooks_push_error: null,
        })
        .in("id", ids);
      return { error: null, qbPurchaseId: payment.Id };
    }

    const now = new Date().toISOString();
    const stamp = async (purchaseId: string) => {
      const linked = await supabase
        .from("invoices")
        .update({ quickbooks_purchase_id: purchaseId, quickbooks_pushed_at: now, quickbooks_push_error: null })
        .in("id", ids);
      // The sync dedup key goes on exactly ONE row — its lookup is a
      // maybeSingle(), which errors out if two rows ever share the key.
      const keyed = linked.error
        ? linked
        : await supabase.from("invoices").update({ quickbooks_id: `qb_purchase_${purchaseId}` }).eq("id", rows[0].id);
      if (keyed.error) {
        throw new Error(`In QuickBooks as Expense #${purchaseId}, but the app couldn't record the link: ${keyed.error.message}`);
      }
    };

    // QBO may already hold this charge: Nicole added it from the bank feed
    // before the receipt was filed, or an earlier app copy outlived its
    // deleted receipt. Same card/bank account, same amount, within four days,
    // the same vendor (a payee-less feed entry only on the very same day),
    // and no app row already claims it → adopt the closest one.
    if (rows[0].invoice_date) {
      const date = rows[0].invoice_date;
      const nearby = await qbQuery<QBExistingTxn>(
        realmId,
        accessToken,
        `SELECT * FROM Purchase WHERE TxnDate >= '${shiftDate(date, -4)}' AND TxnDate <= '${shiftDate(date, 4)}' MAXRESULTS 1000`,
        environment,
      );
      const wanted = normalizeVendorName(rows[0].vendor_name);
      const sameCharge = nearby
        .filter(
          (p) =>
            cents(Number(p.TotalAmt)) === cents(Math.abs(total)) &&
            Boolean(p.Credit) === isCredit &&
            p.AccountRef?.value === paymentAccount!.Id &&
            (p.EntityRef?.value === vendorId ||
              (Boolean(p.EntityRef?.name) && normalizeVendorName(p.EntityRef!.name!) === wanted) ||
              (!p.EntityRef?.value && p.TxnDate === date)),
        )
        .sort((a, b) => daysApart(a.TxnDate, date) - daysApart(b.TxnDate, date));
      const { blocked, imported } = await claimsOn(supabase, "purchase", sameCharge.map((p) => p.Id));
      const existing = sameCharge.find((p) => !blocked.has(p.Id));
      if (existing) {
        await retireImported(supabase, imported.get(existing.Id) ?? [], rows[0].id);
        await stamp(existing.Id);
        return { error: null, qbPurchaseId: existing.Id };
      }
    }

    const created = await qbPost<QBPurchaseCreated>(realmId, accessToken, "Purchase", {
      PaymentType: paymentType,
      ...(isCredit ? { Credit: true } : {}),
      AccountRef: { value: paymentAccount.Id },
      EntityRef: { value: vendorId, type: "Vendor" },
      TxnDate: rows[0].invoice_date ?? undefined,
      PrivateNote: `Penney app ${isCredit ? "credit" : "receipt"} ${rows[0].id} — auto-filed`,
      Line: expenseLines(rows, accounts, jobs),
    }, environment);

    await stamp(created.Id);
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

/**
 * Mirror an UNPAID vendor bill into QBO as a Bill the moment it's filed, so
 * A/P shows on the QuickBooks Bills page and Nicole can pay from there.
 * Pass every invoice row the bill produced (splits become Bill lines).
 * Idempotent; never throws — errors land on quickbooks_push_error.
 */
export async function pushVendorBillToQuickBooks(
  invoiceIds: string[],
): Promise<{ error: string | null; qbBillId?: string }> {
  const supabase = createAdminClient();

  const recordError = async (message: string, ids: string[] = invoiceIds) => {
    await supabase
      .from("invoices")
      .update({ quickbooks_push_error: message.slice(0, 500) })
      .in("id", ids);
  };

  try {
    if (invoiceIds.length === 0) return { error: "No invoices to push" };
    if (!(await isQuickBooksConnected())) return { error: "QuickBooks not connected" };

    const { rows: loaded, error: loadErr } = await loadPushable(supabase, invoiceIds);
    if (!loaded) return { error: loadErr ?? "Invoices not found" };

    const isMirrored = (r: InvoiceRow) => Boolean(r.quickbooks_bill_id || r.quickbooks_purchase_id || r.quickbooks_id);
    const rows = loaded.filter((r) => !isMirrored(r));
    if (rows.length === 0) {
      return { error: null, qbBillId: loaded.find(isMirrored)?.quickbooks_bill_id ?? undefined };
    }
    const ids = rows.map((r) => r.id);

    // Paid rows go through the Purchase path, not A/P.
    if (rows.some((r) => r.payment_status === "paid")) return { error: null };

    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (total === 0) return { error: null };

    // An unpaid credit is a VendorCredit in QBO — same lines, same job, but
    // it sits against A/P instead of adding to it.
    const isCredit = total < 0;

    const badDate = implausibleDate(rows);
    if (badDate) {
      await recordError(badDate, ids);
      return { error: badDate };
    }
    const twin = await findPushedTwin(supabase, rows, total);
    if (twin) {
      await recordError(twin, ids);
      return { error: twin };
    }

    const { jobs, error: jobErr } = await jobIdsFor(rows);
    if (jobErr) {
      await recordError(jobErr, ids);
      return { error: jobErr };
    }

    const { accessToken, realmId, environment } = await getValidAccessToken();

    const accounts = await qbQuery<QBAccount>(
      realmId,
      accessToken,
      "SELECT Id, Name, FullyQualifiedName, AccountType FROM Account WHERE Active = true MAXRESULTS 1000",
      environment,
    );

    const vendorId = await ensureVendor(realmId, accessToken, environment, rows[0].vendor_name);
    const entity = isCredit ? "VendorCredit" : "Bill";
    const now = new Date().toISOString();
    const stamp = async (billId: string) => {
      const linked = await supabase
        .from("invoices")
        .update({ quickbooks_bill_id: billId, quickbooks_pushed_at: now, quickbooks_push_error: null })
        .in("id", ids);
      // Sync dedup key on exactly ONE row, matching sync.ts's qb_bill_<Id>.
      // A VendorCredit gets its own prefix — QBO numbers each entity type
      // separately, so VendorCredit 412 and Bill 412 both exist.
      const keyed = linked.error
        ? linked
        : await supabase
            .from("invoices")
            .update({ quickbooks_id: `${isCredit ? "qb_vendorcredit" : "qb_bill"}_${billId}` })
            .eq("id", rows[0].id);
      if (keyed.error) {
        throw new Error(`In QuickBooks as ${entity} #${billId}, but the app couldn't record the link: ${keyed.error.message}`);
      }
    };

    // Nicole may have entered this bill by hand already. Adopt it only when
    // it is clearly the same bill: same vendor, same total, coded to the same
    // job, not claimed by another app row, and either the same invoice #
    // within a month or no conflicting invoice # within a week.
    if (!isCredit && rows[0].invoice_date) {
      const date = rows[0].invoice_date;
      const nearby = await qbQuery<QBExistingTxn>(
        realmId,
        accessToken,
        `SELECT * FROM Bill WHERE VendorRef = '${vendorId}' AND TxnDate >= '${shiftDate(date, -30)}' AND TxnDate <= '${shiftDate(date, 30)}'`,
        environment,
      );
      const inv = invoiceKey(rows[0].invoice_number);
      const wantJobs = new Set([...jobs.values()].filter((j): j is string => Boolean(j)));
      const sameBill = nearby
        .filter((b) => {
          if (cents(Number(b.TotalAmt)) !== cents(total)) return false;
          const billJobs = new Set(
            (b.Line ?? [])
              .map((l) => l.AccountBasedExpenseLineDetail?.CustomerRef?.value ?? l.ItemBasedExpenseLineDetail?.CustomerRef?.value)
              .filter((j): j is string => Boolean(j)),
          );
          const sameJob = wantJobs.size === 0 ? billJobs.size === 0 : [...billJobs].some((j) => wantJobs.has(j));
          if (!sameJob) return false;
          const doc = invoiceKey(b.DocNumber ?? null);
          if (inv && doc) return doc === inv && daysApart(b.TxnDate, date) <= 30;
          return daysApart(b.TxnDate, date) <= 7;
        })
        .sort((a, b) => daysApart(a.TxnDate, date) - daysApart(b.TxnDate, date));
      const { blocked, imported } = await claimsOn(supabase, "bill", sameBill.map((b) => b.Id));
      const existing = sameBill.find((b) => !blocked.has(b.Id));
      if (existing) {
        await retireImported(supabase, imported.get(existing.Id) ?? [], rows[0].id);
        await stamp(existing.Id);
        return { error: null, qbBillId: existing.Id };
      }
    }

    const created = await qbPost<QBPurchaseCreated>(
      realmId,
      accessToken,
      entity,
      {
        VendorRef: { value: vendorId },
        TxnDate: rows[0].invoice_date ?? undefined,
        ...(isCredit ? {} : { DueDate: rows[0].due_date ?? undefined }),
        PrivateNote: `Penney app ${isCredit ? "vendor credit" : "bill"} ${rows[0].id} — auto-filed`,
        Line: expenseLines(rows, accounts, jobs),
      },
      environment,
    );

    await stamp(created.Id);
    return { error: null, qbBillId: created.Id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await recordError(message);
    } catch {
      // best-effort
    }
    return { error: message };
  }
}

/**
 * Is there still a live QuickBooks copy of this row? Deleting a pushed row
 * in the app used to leave its QBO Expense behind (Home Depot $75.20, two
 * Building Center receipts) — so deletes check here first. Fails open: if
 * QuickBooks can't be reached, the delete is not blocked.
 */
export async function liveQuickBooksCopy(invoiceId: string): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data: row } = await supabase
      .from("invoices")
      .select("quickbooks_purchase_id, quickbooks_bill_id, quickbooks_id, amount")
      .eq("id", invoiceId)
      .maybeSingle();
    if (!row || (!row.quickbooks_purchase_id && !row.quickbooks_bill_id)) return null;
    if (!(await isQuickBooksConnected())) return null;
    const { accessToken, realmId, environment } = await getValidAccessToken();
    // A paid bill's quickbooks_purchase_id is its BillPayment — the Bill is
    // the copy that matters.
    // An unpaid credit's quickbooks_bill_id holds a VendorCredit id.
    const isVendorCredit =
      Boolean(row.quickbooks_id?.startsWith("qb_vendorcredit_")) || (Boolean(row.quickbooks_bill_id) && Number(row.amount) < 0);
    const [entity, label, id] = row.quickbooks_bill_id
      ? isVendorCredit
        ? ["VendorCredit", "Vendor credit", row.quickbooks_bill_id]
        : ["Bill", "Bill", row.quickbooks_bill_id]
      : ["Purchase", "Expense", row.quickbooks_purchase_id];
    const found = await qbQuery<{ Id: string }>(realmId, accessToken, `SELECT Id FROM ${entity} WHERE Id = '${id}'`, environment);
    if (found.length === 0) return null;
    return `This is already in QuickBooks as ${label} #${id}. Delete it in QuickBooks first (or ask Nicole), then delete it here — otherwise QuickBooks keeps a copy the app no longer has.`;
  } catch (err) {
    console.error("[liveQuickBooksCopy] check failed", {
      invoiceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Pushes that failed (QBO down, an account renamed, a job that couldn't be
 * created) used to sit failed forever — 21 card receipts after the 10/6
 * card-account change. The cron retries recent ones. Duplicates the app
 * deliberately held back and check/cash refunds are not retried, and a
 * split receipt goes back whole, only once every piece is confirmed.
 * Stops starting new pushes 40s after `startedAt` (the cron's own start) so
 * the whole cron finishes inside its 60s.
 */
export async function retryFailedQuickBooksPushes(
  startedAt = Date.now(),
  limit = 25,
): Promise<{ retried: number; stillFailing: number }> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 45 * 864e5).toISOString();
  const { data } = await supabase
    .from("invoices")
    .select("id, split_group_id, payment_status")
    .not("quickbooks_push_error", "is", null)
    .not("quickbooks_push_error", "like", `${DUPLICATE_NOTE}%`)
    .not("quickbooks_push_error", "like", "credit refunded%")
    .is("quickbooks_purchase_id", null)
    .is("quickbooks_bill_id", null)
    .is("duplicate_of_id", null)
    .not("project_id", "is", null)
    .or("review_status.is.null,review_status.neq.needs_review")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);

  const batches = new Map<string, { ids: string[]; paid: boolean }>();
  for (const r of data ?? []) {
    if (!r.split_group_id) {
      batches.set(`row:${r.id}`, { ids: [r.id], paid: r.payment_status === "paid" });
      continue;
    }
    const key = `split:${r.split_group_id}`;
    if (batches.has(key)) continue;
    const { data: pieces } = await supabase
      .from("invoices")
      .select("id, review_status, project_id, payment_status")
      .eq("split_group_id", r.split_group_id)
      .is("duplicate_of_id", null);
    const all = pieces ?? [];
    if (all.length === 0 || all.some((p) => p.review_status === "needs_review" || !p.project_id)) continue;
    batches.set(key, { ids: all.map((p) => p.id), paid: all.every((p) => p.payment_status === "paid") });
  }

  let retried = 0;
  let stillFailing = 0;
  for (const { ids, paid } of batches.values()) {
    if (Date.now() - startedAt > 40_000) break;
    const result = paid ? await pushVendorExpenseToQuickBooks(ids) : await pushVendorBillToQuickBooks(ids);
    retried += ids.length;
    if (result.error) stillFailing += ids.length;
  }
  return { retried, stillFailing };
}
