import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSubName } from "@/lib/subs/resolve-subcontractor";

// The router dedup guard — the shared "is this bill already in the books?"
// check behind every invoice writer.
//
// The 8/20/26 duplicate purge ($25,578 across ~15 jobs) traced every dupe to
// the same disease: writers only deduped on EXACT keys (gmail_message_id, or
// project+vendor+invoice#), so a bill re-entered from a ledger audit or bank
// reconcile — no gmail id, vendor spelled differently ("BC of Essex" vs
// "Building Center of Essex", "COSENTINO PLUMBI" vs "Cosentino Plumbing"),
// often dated by payment instead of invoice — sailed straight in and doubled
// the job's Spent.
//
// This guard matches the way the dupes actually looked: same money + same
// vendor FAMILY + close in time (vendor+amount within ±35 days, the rule the
// purge prescribed). It never blocks a filing on its own — callers file the
// row FLAGGED (review_status=needs_review with the returned reason) so a
// suspected double dies in the review queue instead of silently inflating
// Spent, while a genuine second bill (Town Line's two $5,800 invoices, Rest
// Stop's monthly porta charge) survives with one human glance.

export interface InvoiceDedupInput {
  vendorName: string;
  amount: number;
  invoiceNumber?: string | null;
  /** YYYY-MM-DD. Missing dates fall back to a created-recently window. */
  invoiceDate?: string | null;
  projectId?: string | null;
  /** Skip this row (updating/splitting an existing invoice). */
  excludeInvoiceId?: string | null;
}

export interface LikelyDuplicateInvoice {
  id: string;
  project_id: string | null;
  vendor_name: string;
  amount: number;
  invoice_number: string | null;
  invoice_date: string | null;
  payment_status: string | null;
  /** House-style review_reason sentence, ready for the /spent/review queue. */
  reason: string;
}

interface CandidateRow {
  id: string;
  project_id: string | null;
  vendor_name: string | null;
  amount: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  payment_status: string | null;
  created_at: string | null;
}

const CANDIDATE_COLUMNS =
  "id, project_id, vendor_name, amount, invoice_number, invoice_date, payment_status, created_at";

/** Same invoice_date within this many days = the same bill until proven otherwise. */
const DATE_WINDOW_DAYS = 35;
/** A candidate with no usable date still counts if it entered the books this recently. */
const CREATED_WINDOW_DAYS = 45;

// Words that describe what a vendor DOES, not who they ARE. Two vendors
// sharing only these are different companies ("Jackson Lumber" vs "Moynihan
// Lumber"), so they never establish a match on their own.
const GENERIC_TOKENS = new Set([
  "the", "and", "for", "inc", "llc", "corp", "co", "ltd",
  "building", "center", "centre", "supply", "supplies", "supplier",
  "construction", "contracting", "contractors", "builders", "brothers", "bros",
  "sons", "services", "service", "solutions", "group", "company",
  "home", "house", "office", "store", "depot", "hardware", "lumber",
  "north", "south", "east", "west", "shore", "new", "england", "boston",
  "general", "custom", "quality", "professional", "pros",
  "fuel", "gas", "oil", "energy", "electric", "electrical", "electrician",
  "plumbing", "heating", "cooling", "hvac", "painting", "paint", "plaster",
  "plastering", "tile", "floors", "floor", "flooring", "glass", "roofing",
  "siding", "masonry", "concrete", "landscaping", "disposal", "waste",
  "rental", "rentals", "equipment", "insurance", "bank",
]);

function squash(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * Do two free-text vendor names plausibly name the same company?
 * Tiered: normalized equality → space-insensitive equality ("E-Z" vs "EZ") →
 * substring containment ("Cosentino Plumbi" ⊂ "Cosentino Plumbing") →
 * shared distinctive token ("BC of ESSEX" ↔ "Building Center of ESSEX").
 */
export function vendorsLookAlike(a: string, b: string): boolean {
  const na = normalizeSubName(a);
  const nb = normalizeSubName(b);
  if (na.length < 3 || nb.length < 3) return false;
  if (na === nb) return true;
  // Compare space-stripped so "E-Z Disposal" ⊂ "EZ Disposal Services" still hits.
  const sa = squash(na);
  const sb = squash(nb);
  if (sa === sb) return true;
  if (sa.length >= 5 && sb.length >= 5 && (sa.includes(sb) || sb.includes(sa))) return true;

  const distinctive = (s: string) =>
    s.split(" ").filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
  const ta = new Set(distinctive(na));
  return distinctive(nb).some((t) => ta.has(t));
}

function daysBetween(a: string, b: string): number | null {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.abs(ta - tb) / 86_400_000;
}

function normalizeInvoiceNumber(raw: string | null | undefined): string | null {
  const n = (raw ?? "").toLowerCase().replace(/[#\s]/g, "").trim();
  return n.length >= 2 ? n : null;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildReason(
  match: CandidateRow,
  kind: "invoice_number" | "amount",
  inputProjectId: string | null | undefined,
): string {
  const when = match.invoice_date ? ` (${match.invoice_date})` : "";
  const crossJob =
    match.project_id && inputProjectId && match.project_id !== inputProjectId
      ? " on a different job"
      : "";
  const identity =
    kind === "invoice_number"
      ? `invoice #${match.invoice_number} for $${fmtMoney(Number(match.amount ?? 0))}`
      : "for the same amount";
  return `looks like the SAME bill as ${match.vendor_name} ${identity}${when} already in the books${crossJob} — confirm it's really a second one, or discard`;
}

/**
 * Find an existing invoice this one is probably a duplicate of. Returns null
 * when nothing matches — and on ANY error, because the guard decorates a
 * filing and must never block one.
 *
 * Match rules, strongest first:
 *  1. Same normalized invoice number + same vendor family (any amount, any
 *     date — an invoice number is identity, and a re-key with a corrected
 *     amount SHOULD surface for review).
 *  2. Same amount to the cent + same vendor family + invoice dates within
 *     ±35 days (or, when either date is missing, the existing row entered
 *     the books in the last 45 days).
 * Searches across ALL jobs — a double-filed bill often lands on the wrong
 * project (the two Gallegos jobs share one street address) — and says so in
 * the reason when the projects differ.
 */
export async function findLikelyDuplicateInvoice(
  supabase: SupabaseClient,
  input: InvoiceDedupInput,
): Promise<LikelyDuplicateInvoice | null> {
  try {
    const vendorName = (input.vendorName ?? "").trim();
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!vendorName || !Number.isFinite(amount) || amount <= 0) return null;

    const invoiceNumber = normalizeInvoiceNumber(input.invoiceNumber);
    const numberPattern = (input.invoiceNumber ?? "")
      .trim()
      .replace(/^#/, "")
      .replace(/[%_\\]/g, "");

    const [byAmount, byNumber] = await Promise.all([
      supabase
        .from("invoices")
        .select(CANDIDATE_COLUMNS)
        .eq("amount", amount)
        .order("created_at", { ascending: false })
        .limit(30),
      invoiceNumber && numberPattern.length >= 2
        ? supabase
            .from("invoices")
            .select(CANDIDATE_COLUMNS)
            .ilike("invoice_number", `%${numberPattern}%`)
            .order("created_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: null }),
    ]);

    const seen = new Set<string>();
    const candidates: { row: CandidateRow; kind: "invoice_number" | "amount" }[] = [];
    for (const row of (byNumber.data ?? []) as CandidateRow[]) {
      if (normalizeInvoiceNumber(row.invoice_number) !== invoiceNumber) continue;
      if (!seen.has(row.id)) {
        seen.add(row.id);
        candidates.push({ row, kind: "invoice_number" });
      }
    }
    for (const row of (byAmount.data ?? []) as CandidateRow[]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        candidates.push({ row, kind: "amount" });
      }
    }

    const now = new Date().toISOString();
    const matches = candidates.filter(({ row, kind }) => {
      if (input.excludeInvoiceId && row.id === input.excludeInvoiceId) return false;
      if (!row.vendor_name || !vendorsLookAlike(vendorName, row.vendor_name)) return false;
      if (kind === "invoice_number") return true;
      if (input.invoiceDate && row.invoice_date) {
        const gap = daysBetween(input.invoiceDate, row.invoice_date);
        return gap !== null && gap <= DATE_WINDOW_DAYS;
      }
      const age = row.created_at ? daysBetween(row.created_at, now) : null;
      return age !== null && age <= CREATED_WINDOW_DAYS;
    });
    if (matches.length === 0) return null;

    // Prefer the strongest story: same job beats cross-job, an invoice-number
    // hit beats an amount hit.
    matches.sort((a, b) => {
      const sameJob = (m: { row: CandidateRow }) =>
        input.projectId && m.row.project_id === input.projectId ? 0 : 1;
      const strength = (m: { kind: string }) => (m.kind === "invoice_number" ? 0 : 1);
      return sameJob(a) - sameJob(b) || strength(a) - strength(b);
    });

    const best = matches[0];
    return {
      id: best.row.id,
      project_id: best.row.project_id,
      vendor_name: best.row.vendor_name ?? vendorName,
      amount: Number(best.row.amount ?? 0),
      invoice_number: best.row.invoice_number,
      invoice_date: best.row.invoice_date,
      payment_status: best.row.payment_status,
      reason: buildReason(best.row, best.kind, input.projectId),
    };
  } catch {
    return null;
  }
}
