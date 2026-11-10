import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Is this bill already in the books? Used by the bill drop's save step
 * (/api/bills/commit) before it files a bill.
 *
 * Looks at the job's bills from the same vendor family (first word of the
 * vendor name, so "Sygma Stone" finds "Sygma Stone Inc"). A bill filed split
 * across budget lines is several rows sharing one split_group_id, so it is
 * judged as one bill. It is a match when:
 *  - one of its rows carries the same invoice number, or
 *  - it was filed in the last 45 days and its total equals this amount.
 *
 * The old rule only caught ONE row with the same amount, so a split bill
 * dropped a second time filed clean and went to QuickBooks twice. Sygma Stone
 * #16789 on Ouellette (11/10/2026) was filed at 12:17 as $863 + $2,725 +
 * $4,260.44; dropping the PDF again would have doubled it.
 *
 * A credit is only compared with credits, a charge with charges. Pieces of a
 * split that went to another job are not seen here; the invoice number still
 * catches those. Nothing here blocks: the caller files a match flagged for
 * review, same as before.
 */

export type BookedBillRow = {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  amount: unknown;
  split_group_id: string | null;
  created_at: string;
};

export type BookedDuplicate = {
  invoiceId: string;
  vendorName: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  /** The booked bill's total in dollars (all of its split rows on this job). */
  amount: number;
  /** How many rows (budget-line pieces) it was filed as. */
  lines: number;
  matchedOn: "invoice_number" | "amount";
};

const DUPLICATE_WINDOW_MS = 45 * 86_400_000;

const cents = (value: unknown): number | null =>
  value == null || value === "" || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 100);

/** "INV-016789", "#16789" and "16789" are the same bill number. No digits, no number. */
export function billNumberKey(value: string | null | undefined): string | null {
  const clean = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^(invoice|inv|no|number)+/, "")
    .replace(/^0+(?=\d)/, "");
  return /\d/.test(clean) ? clean : null;
}

/** The first word of the vendor name, safe for an ilike prefix. Too short means no check. */
export function vendorFamilyToken(vendorName: string): string | null {
  const token = vendorName.trim().split(/\s+/)[0]?.replace(/[%_,\\]/g, "") ?? "";
  return token.length >= 3 ? token : null;
}

export function pickBookedDuplicate(
  rows: BookedBillRow[],
  bill: { invoiceNumber: string | null; amount: number },
  now = Date.now(),
): BookedDuplicate | null {
  const groups = new Map<string, BookedBillRow[]>();
  for (const row of rows) {
    const key = row.split_group_id ?? row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const wantNumber = billNumberKey(bill.invoiceNumber);
  const wantCents = Math.round(bill.amount * 100);

  let byAmount: BookedDuplicate | null = null;
  for (const group of groups.values()) {
    const amounts = group.map((r) => cents(r.amount));
    if (amounts.some((a) => a === null)) continue;
    const total = (amounts as number[]).reduce((sum, a) => sum + a, 0);
    if (Math.sign(total) !== Math.sign(wantCents)) continue;

    const found = (matchedOn: BookedDuplicate["matchedOn"]): BookedDuplicate => ({
      invoiceId: group[0].id,
      vendorName: group[0].vendor_name?.trim() || "the same vendor",
      invoiceNumber: group.find((r) => r.invoice_number?.trim())?.invoice_number?.trim() ?? null,
      invoiceDate: group[0].invoice_date,
      amount: total / 100,
      lines: group.length,
      matchedOn,
    });

    if (wantNumber && group.some((r) => billNumberKey(r.invoice_number) === wantNumber)) {
      return found("invoice_number");
    }
    const recent = group.some((r) => Date.parse(r.created_at) >= now - DUPLICATE_WINDOW_MS);
    if (!byAmount && recent && total === wantCents) byAmount = found("amount");
  }
  return byAmount;
}

export async function findBookedDuplicate(
  db: SupabaseClient,
  bill: { projectId: string | null; vendorName: string; invoiceNumber: string | null; amount: number },
): Promise<BookedDuplicate | null> {
  const token = vendorFamilyToken(bill.vendorName);
  if (!token) return null;
  let query = db
    .from("invoices")
    .select("id, vendor_name, invoice_number, invoice_date, amount, split_group_id, created_at")
    .ilike("vendor_name", `${token}%`)
    .order("created_at", { ascending: false })
    .limit(1000);
  query = bill.projectId ? query.eq("project_id", bill.projectId) : query.is("project_id", null);
  const { data, error } = await query;
  if (error) throw new Error(`Could not check the books for this bill: ${error.message}`);
  return pickBookedDuplicate((data ?? []) as BookedBillRow[], bill);
}

/** The review note a flagged copy files with. */
export function duplicateReviewReason(d: BookedDuplicate): string {
  const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const what = `${d.vendorName}${d.invoiceNumber ? ` #${d.invoiceNumber}` : ""}`;
  const filed = `${usd(d.amount)}${d.lines > 1 ? ` across ${d.lines} budget lines` : ""}${d.invoiceDate ? `, ${d.invoiceDate}` : ""}`;
  return d.matchedOn === "invoice_number"
    ? `looks like the SAME bill as ${what} (${filed}) already in the books on this job, same invoice number — confirm it's really a second one, or discard`
    : `looks like the SAME bill as ${what} for the same amount (${filed}) already in the books — confirm it's really a second one, or discard`;
}
