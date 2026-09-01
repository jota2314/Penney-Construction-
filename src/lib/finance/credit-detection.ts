/**
 * A credit memo is money coming BACK — a returned pallet, a restocked
 * bundle, a billing correction. It is the mirror image of a bill, and the
 * capture flows used to refuse it outright ("Amount must be more than
 * zero"), so the only way to book one was to hand-edit the row afterwards
 * (BC of Essex 16443, $42.50 pallet refund on Gallegos, filed positive and
 * flipped by hand 8/28).
 *
 * A credit books as a NEGATIVE invoices row: same vendor, same job, same
 * budget line, so the line's Spent nets down instead of drifting up.
 *
 * Deliberately deterministic, same as the quote guard — the sign is too
 * important to leave to a vision model that reads "($42.50)" as 42.50.
 * "Credit Card" and a "Payments/Credits" summary line are NOT credits, so
 * every pattern here is anchored to a credit DOCUMENT.
 */

export type CreditCheck = { isCredit: boolean; reason: string | null };

const CREDIT_TYPES = ["credit_memo", "credit", "credit_note", "refund", "return"];

const CREDIT_MEMO = /\bcredit\s*(?:memo(?:randum)?|note|invoice)\b/i;
const CREDIT_NUMBER = /\bcredit\s*(?:memo\s*)?(?:no\b|#|num(?:ber)?\b)/i;
const TOTAL_CREDIT = /\btotal\s+credit\b/i;
const RETURN_DOC = /\b(?:return\s+authorization|merchandise\s+credit|rma\s*(?:no\b|#|num))/i;
const REFUND_WORD = /\brefund(?:ed)?\b/i;
// ($42.50) — accounting parentheses on the document's own total line.
const PARENTHESIZED_TOTAL =
  /\b(?:total|amount|balance|subtotal|sales tax)[^\n]{0,40}\(\s*\$?\s*[\d,]+\.\d{2}\s*\)/i;

export function detectCreditDocument(input: {
  documentType?: string | null;
  filename?: string | null;
  extractedText?: string | null;
  amount?: number | null;
}): CreditCheck {
  const documentType = (input.documentType ?? "").toLowerCase();
  const filename = input.filename ?? "";
  const text = input.extractedText ?? "";
  const amount = typeof input.amount === "number" ? input.amount : null;

  if (CREDIT_TYPES.includes(documentType)) {
    return { isCredit: true, reason: `the scan read this as a ${documentType.replace("_", " ")}` };
  }
  if (amount !== null && amount < 0) {
    return { isCredit: true, reason: "the document's total is negative" };
  }
  if (CREDIT_MEMO.test(filename) || /\brefund\b/i.test(filename)) {
    return { isCredit: true, reason: `the file is named "${filename}"` };
  }

  if (!text) return { isCredit: false, reason: null };

  if (CREDIT_MEMO.test(text)) {
    return { isCredit: true, reason: 'the document says "Credit Memo"' };
  }
  if (TOTAL_CREDIT.test(text)) {
    return { isCredit: true, reason: 'it totals to a "Total Credit"' };
  }
  if (CREDIT_NUMBER.test(text)) {
    return { isCredit: true, reason: "it carries a credit memo number" };
  }
  if (RETURN_DOC.test(text)) {
    return { isCredit: true, reason: "it is a return / merchandise credit" };
  }
  if (PARENTHESIZED_TOTAL.test(text) && (REFUND_WORD.test(text) || TOTAL_CREDIT.test(text))) {
    return { isCredit: true, reason: "its total is in parentheses — money coming back" };
  }

  return { isCredit: false, reason: null };
}

/**
 * Credits come off the scan with either sign — the model reads "($42.50)"
 * as 42.50 about as often as it reads it as -42.50. One place decides.
 */
export function signedAmount(amount: number | null, isCredit: boolean): number | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  const magnitude = Math.abs(amount);
  return isCredit ? -magnitude : magnitude;
}
