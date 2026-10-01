/**
 * What the field crew is allowed to see in the Job Folder.
 *
 * Jorge (10/1): the guys get every real job's info, drawings, photos and daily
 * logs — never the office or warehouse jobs, and nothing money-wise or
 * sensitive. Files are filtered three ways because the category alone isn't
 * trustworthy: email auto-filing has dropped invoices into "permits", bank
 * statements and a résumé into "other", and deposit checks into "photos".
 */

/** File categories the crew may open. "other" is deliberately excluded — it's
 * where invoices, statements, audits and HR paperwork end up. */
export const CREW_DOC_CATEGORIES = ["construction_drawings", "plans", "permits", "specs"] as const;
export const CREW_FILE_CATEGORIES = [...CREW_DOC_CATEGORIES, "photos"] as const;

/** Office / warehouse jobs that exist for clocking time and overhead, not
 * jobsites. The crew still clocks into Shop; it just isn't in the folder. */
const INTERNAL_PROJECT_NUMBERS = new Set(["PC-2026-162", "PC-2026-171", "PC-2026-179"]);
const INTERNAL_NAME = /^\s*(office|shop|warehouse)\b/i;

export function isInternalJob(p: {
  name?: string | null;
  project_number?: string | null;
  is_overhead?: boolean | null;
}): boolean {
  return (
    Boolean(p.is_overhead) ||
    (!!p.project_number && INTERNAL_PROJECT_NUMBERS.has(p.project_number)) ||
    INTERNAL_NAME.test(p.name ?? "")
  );
}

// Money and paperwork words. Matched anywhere in the name:
const SENSITIVE_PARTS = [
  "invoice", "quotation", "proposal", "estimate", "receipt", "payment", "statement",
  "deposit", "cheque", "contract", "agreement", "financ", "audit", "budget", "ledger",
  "payroll", "insurance", "allowance", "markup", "waiver", "resume", "résumé", "workbook",
  "change[\\s_-]*order", "welcome[\\s_-]*deck", "fit[\\s_-]*report", "offer[\\s_-]*letter",
];
// ...and as whole words only, where a substring would catch innocent names.
// File names use _ and - as spaces, so a "word" is bounded by any non-letter
// (lookbehind would be neater but breaks older iPhones' Safari).
const SENSITIVE_WORDS = [
  "inv", "quotes?", "quoted", "paid", "checks", "costs?", "orders?", "deed", "bills?", "w-?9",
  "1099", "tax(es)?", "coi", "liens?", "cv", "bank", "margin",
  // "Pricing set" is an architect's drawing issue, not a price — it stays.
  "pric(e|es|ing)(?![\\s_-]*set)",
];
// "CO" alone means carbon monoxide on drawings, so only "change order" is above.
const SENSITIVE_NAME = new RegExp(
  `${SENSITIVE_PARTS.join("|")}|(?:^|[^a-z])(?:${SENSITIVE_WORDS.join("|")})(?![a-z])`,
  "i",
);

// Emails, spreadsheets, web pages and text notes are office paperwork; the
// crew needs PDFs, pictures and the odd Word scope doc.
const SENSITIVE_MIME = /rfc822|spreadsheet|excel|csv|html|text\/plain/i;
const SENSITIVE_EXT = /\.(eml|msg|xlsx?|xlsm|csv|html?|txt|numbers)$/i;

export function isCrewVisibleFile(f: {
  category: string | null;
  filename: string | null;
  mime_type?: string | null;
}): boolean {
  if (!f.category || !(CREW_FILE_CATEGORIES as readonly string[]).includes(f.category)) return false;
  const name = f.filename ?? "";
  if (SENSITIVE_NAME.test(name) || SENSITIVE_EXT.test(name)) return false;
  if (f.mime_type && SENSITIVE_MIME.test(f.mime_type)) return false;
  return true;
}

/** Same identity the office Files tab uses for its hide list and overrides. */
export function fileKey(filename: string | null, size: number | null): string {
  return `${(filename || "").toLowerCase()}|${size ?? 0}`;
}
