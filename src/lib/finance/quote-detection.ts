/**
 * A quote is a price OFFERED, not money owed. Booked as an invoice it
 * inflates the job's Spent with a bill that doesn't exist — a BC of Essex
 * QUOTATION ("Quote 12286.pdf", header "Quotation", Quote No, expiration
 * date, buyer signature line) filed through field capture as three PAID
 * rows on Sobol, $6,834.48 of phantom cost. Every path that turns
 * extracted paperwork into an invoices row runs this check first.
 *
 * Deliberately deterministic — the vision model already misread that
 * document once, so the guard cannot be another model call.
 */

export type QuoteCheck = { isQuote: boolean; reason: string | null };

const QUOTE_WORD = /\b(?:quote|quotation|estimate|proposal)\b/i;
const QUOTATION_HEADER = /\bquotation\b/i;
const QUOTE_NUMBER = /\b(?:quote|quotation)\s*(?:no\b|#|num(?:ber)?\b|date\b)/i;
const PROPOSAL_NUMBER = /\b(?:proposal|estimate)\s*(?:no\b|#|num(?:ber)?\b)/i;
const EXPIRATION =
  /\b(?:expiration date|expires? on|valid until|valid through|valid for \d+ days|this (?:quote|quotation|estimate|proposal) is valid)\b/i;
const ACCEPTANCE =
  /\b(?:accepted by|customer acceptance|acceptance signature|buyer'?s? signature|to accept this (?:quote|quotation|estimate|proposal)|sign(?:ature)? (?:below )?to (?:accept|approve|proceed))\b/i;
// A real invoice often references the quote it fulfills ("per Quote #12286").
// An explicit invoice header outweighs a bare quote-number reference.
const INVOICE_HEADER = /\binvoice\s*(?:no\b|#|num(?:ber)?\b|date\b)/i;

export function detectQuoteDocument(input: {
  documentType?: string | null;
  filename?: string | null;
  extractedText?: string | null;
}): QuoteCheck {
  const documentType = (input.documentType ?? "").toLowerCase();
  const filename = input.filename ?? "";
  const text = input.extractedText ?? "";

  if (["quote", "quotation", "estimate", "proposal"].includes(documentType)) {
    return { isQuote: true, reason: `the scan read this as a ${documentType}` };
  }

  if (/quote|quotation|proposal/i.test(filename) || /\bestimate\b/i.test(filename)) {
    return { isQuote: true, reason: `the file is named "${filename}"` };
  }

  if (!text) return { isQuote: false, reason: null };

  const hasInvoiceHeader = INVOICE_HEADER.test(text);

  if (QUOTATION_HEADER.test(text)) {
    return { isQuote: true, reason: 'the document says "Quotation"' };
  }
  if (QUOTE_NUMBER.test(text) && !hasInvoiceHeader) {
    return { isQuote: true, reason: "it carries a Quote No with no invoice number" };
  }
  if (PROPOSAL_NUMBER.test(text) && !hasInvoiceHeader) {
    return { isQuote: true, reason: "it carries a proposal/estimate number with no invoice number" };
  }
  if (EXPIRATION.test(text) && QUOTE_WORD.test(text)) {
    return { isQuote: true, reason: "it has an expiration date — prices offered, not billed" };
  }
  if (ACCEPTANCE.test(text) && QUOTE_WORD.test(text) && !hasInvoiceHeader) {
    return { isQuote: true, reason: "it has a customer acceptance signature line" };
  }

  return { isQuote: false, reason: null };
}
