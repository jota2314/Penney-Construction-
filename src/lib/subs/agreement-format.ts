/**
 * Plain helpers for sub agreements that both the office screens and the sub
 * portal use: labels, price lines, the "[FILL IN: ...]" blank finder, the
 * TEST-sub rule and the agreement numbers. No server code, no database, so a
 * "use client" component can import it.
 */
import { FILL_IN_TOKEN } from "@/lib/sub-portal/statuses";
import type { SubAgreementKind, SubPriceBasis } from "@/lib/sub-portal/payload";

export const AGREEMENT_KIND_LABEL: Record<SubAgreementKind, string> = {
  master: "Master subcontract agreement",
  work_order: "Work order",
  change_order: "Sub change order",
};

export const PRICE_BASIS_LABEL: Record<SubPriceBasis, string> = {
  lump_sum: "Lump sum",
  unit: "Unit price",
  time_and_material: "Time and material",
};

/** The office's words for an agreement's status (sentence case). */
export const AGREEMENT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent, waiting for the sub",
  viewed: "Opened by the sub",
  signed: "Signed",
  void: "Void",
  superseded: "Replaced",
};

/** The first line of every drafted section: Ryan deletes it once he has read the section. */
export const REVIEW_MARKER_PREFIX = "[FILL IN: DRAFT for Ryan Penney's review";

export interface AgreementMoney {
  price_basis: SubPriceBasis | null;
  price: number | null;
  unit_rate: number | null;
  unit_label: string | null;
  not_to_exceed: number | null;
}

/**
 * The amount the agreement commits Penney to, the same rule sync_sub_contract
 * uses: the not-to-exceed for time and material, the price otherwise.
 */
export function agreementAmount(a: AgreementMoney): number | null {
  return a.price_basis === "time_and_material" ? a.not_to_exceed : a.price;
}

/**
 * The price as lines a person reads, money to the cent:
 *  ["Lump sum: $6,000.00"]
 *  ["Time and material: $65.00 per hour", "Not to exceed: $4,000.00"]
 *  ["Unit price: $12.50 per sq ft", "Estimated total: $3,000.00"]
 */
export function priceLines(a: AgreementMoney, fmt: (n: number | null) => string): string[] {
  const unit = a.unit_label?.trim() || "unit";
  switch (a.price_basis) {
    case "time_and_material":
      return [
        `Time and material: ${fmt(a.unit_rate)} per ${a.unit_label?.trim() || "hour"}`,
        `Not to exceed: ${fmt(a.not_to_exceed)}`,
      ];
    case "unit":
      return [`Unit price: ${fmt(a.unit_rate)} per ${unit}`, `Estimated total: ${fmt(a.price)}`];
    case "lump_sum":
      return [`Lump sum: ${fmt(a.price)}`];
    default:
      return a.price != null ? [`Price: ${fmt(a.price)}`] : [];
  }
}

export interface FillInBlank {
  /** Index into the text where "[FILL IN" starts. */
  start: number;
  /** Index just past the closing "]" (or the end of the line when it was never closed). */
  end: number;
  /** What Ryan is asked for: "retainage percent of each payment, e.g. 0% or 10%". */
  prompt: string;
  /** The "DRAFT for Ryan Penney's review" line, which is deleted rather than filled. */
  isReview: boolean;
}

/**
 * Every "[FILL IN ...]" in a text, in order. A token someone broke while
 * editing (no closing bracket) still counts, because the database refuses
 * approval on the bare "[FILL IN" too.
 */
export function findFillInBlanks(text: string | null | undefined): FillInBlank[] {
  const out: FillInBlank[] = [];
  if (!text) return out;
  let from = 0;
  for (;;) {
    const start = text.indexOf(FILL_IN_TOKEN, from);
    if (start === -1) break;
    const lineEnd = text.indexOf("\n", start);
    const close = text.indexOf("]", start);
    const limit = lineEnd === -1 ? text.length : lineEnd;
    const end = close !== -1 && close < limit ? close + 1 : limit;
    const inner = text.slice(start + FILL_IN_TOKEN.length, close !== -1 && close < limit ? close : limit);
    const prompt = inner.replace(/^\s*:?\s*/, "").trim();
    out.push({ start, end, prompt, isReview: text.startsWith(REVIEW_MARKER_PREFIX, start) });
    from = Math.max(end, start + FILL_IN_TOKEN.length);
  }
  return out;
}

/** How many "[FILL IN" tokens are left across these texts. */
export function countFillIns(...texts: (string | null | undefined)[]): number {
  return texts.reduce((n, t) => n + findFillInBlanks(t).length, 0);
}

/**
 * Replace one blank with the answer. A review line ("DRAFT for Ryan Penney's
 * review…") is removed with the line break after it.
 */
export function fillBlank(text: string, blank: FillInBlank, answer: string): string {
  if (blank.isReview) {
    const after = text[blank.end] === "\n" ? blank.end + 1 : blank.end;
    return text.slice(0, blank.start) + text.slice(after);
  }
  return text.slice(0, blank.start) + answer + text.slice(blank.end);
}

/** Template text with the review lines taken out (for showing a sub a draft, never for approving). */
export function withoutReviewLines(text: string): string {
  let out = text;
  for (const b of findFillInBlanks(text).filter((x) => x.isReview).reverse()) out = fillBlank(out, b, "");
  return out;
}

/**
 * A TEST sub (plan §8 walk-throughs): company name starts with the word
 * "TEST" in capitals ("TEST Tile Co"). Only a TEST sub may use a test-only
 * template; a real sub never does.
 */
export function isTestSubName(name: string | null | undefined): boolean {
  return /^TEST\b/.test((name ?? "").trim());
}

/** "PC-2026-046" → "046" (the job part of a work order number). */
export function jobCode(projectNumber: string | null | undefined): string {
  const m = (projectNumber ?? "").match(/(\d+)\s*$/);
  return m ? m[1].padStart(3, "0") : "000";
}

/** "MGL Tile Inc" → "MGL"; "Cosentino Plumbing" → "COS". */
export function companyCode(companyName: string | null | undefined): string {
  const word = (companyName ?? "").split(/\s+/).find((w) => /[a-z0-9]/i.test(w)) ?? "SUB";
  const code = word.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 3);
  return code || "SUB";
}

/**
 * Which owner/association terms a work order carries by default. The office
 * ticks or unticks each one; this only pre-ticks the ones that plainly
 * reach a sub's work (insurance naming the owner, protection, condo hours,
 * shut-offs, permit close-out), not the client's own business terms
 * (phases, deposits, the purchase closing, permit fees on the client side).
 * Indemnity and "responsible for any damage" terms are never pre-ticked:
 * Penney's duty to the Owner covers its other subs too, and a sub answers
 * only under the master agreement's Indemnity section (c.149 s.29C), so the
 * office opts in on purpose.
 */
export function flowDownByDefault(term: { title?: string | null; body?: string | null }): boolean {
  const text = `${term.title ?? ""} ${term.body ?? ""}`;
  if (/deposit|purchase|closing|phase 1|phase 2|cancel this contract|indemnif|hold harmless|responsible for any damage/i.test(text)) return false;
  return /insur|additional insured|condo|association|common area|protect|damage|neighbou?r|noisy|shut-?off|work hours|daytime|close-?out|inspection/i.test(text);
}

/** The line a list shows: "Work order WO-046-01 · Pedersen". */
export function agreementTitle(kind: SubAgreementKind, number: string, projectName: string | null): string {
  return `${AGREEMENT_KIND_LABEL[kind]} ${number}${projectName ? ` · ${projectName}` : ""}`;
}
