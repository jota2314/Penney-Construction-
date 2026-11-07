/**
 * Progress invoices: a sub bills a job in draws, and each invoice prints the
 * whole job and then the part THIS invoice asks for, e.g. DL Services'
 * Housecall Pro invoices:
 *
 *     Job Total        $21,550.00
 *     Invoice Amount   $14,000.00
 *     Payment History  Jun 24  $1,000.00
 *
 * The bill is the $14,000. The earlier draws are already their own bills, so
 * filing the job total counts them twice. The scanner used to always take the
 * total ("never the Balance Due", a rule meant for paid receipts that show
 * Balance Due $0.00). It prefilled the job total on every DL draw: 6648
 * Parziale $14,850 (due $7,425), 6704 Pedersen $38,250 (due $5,000), 6701
 * Ouellette $21,550 (due $14,000). The first two were corrected by hand. The
 * third was filed at $21,550 and approved for pay at that amount.
 *
 * Rule: when a document shows an amount due that is above zero but below its
 * total, AND it shows signs of earlier payments or a job/contract total, the
 * amount to file is the amount due. A paid receipt (balance $0), a credit, or
 * a bill whose lower figure is only an early-pay discount (the Peabody light
 * bill's "Discounted Net Amount Due") keeps the total.
 *
 * Deterministic on purpose, like the quote and credit guards: the model reads
 * both figures fine but follows whichever rule the prompt states.
 */

export type AmountPick = {
  /** The amount to file. */
  amount: number | null;
  /** The job total, when the amount filed is a draw against it. */
  jobTotal: number | null;
  reason: string | null;
};

// Wording that means "this total is the whole job, and money was already paid against it".
const PROGRESS_SIGNAL =
  /\b(?:job\s+total|total\s+job\s+price|contract\s+(?:total|amount|price|sum)|payment\s+history|previous(?:ly)?\s+(?:paid|payments?|billed|invoiced)|less\s+(?:previous|prior|payments?|deposits?)|paid\s+to\s+date|(?:payments?|deposits?)\s+(?:received|applied|to\s+date)|deposit\s+paid|progress\s+(?:payment|billing|invoice|draw)|draw\s*(?:#|no\b|number)|retainage|invoice\s+amount)\b/i;

// A line that states what this invoice asks for now.
const DUE_LINE =
  /\b(?:invoice\s+amount|amount\s+due|balance\s+due|amount\s+this\s+invoice|current\s+(?:amount\s+)?due|due\s+this\s+invoice|this\s+(?:invoice|draw|payment))\b[^\n$\d]{0,24}\$?\s*([\d,]+\.\d{2})/i;

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** The amount-due figure printed on the document, skipping early-pay discount lines. */
export function dueFromText(text: string | null | undefined): number | null {
  for (const line of (text ?? "").split(/\r?\n/)) {
    if (/discount/i.test(line)) continue;
    const m = DUE_LINE.exec(line);
    if (!m) continue;
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function pickBillAmount(input: {
  /** The document's total of charges, as read. */
  total: number | null;
  /** The model's read of Amount Due / Balance Due / Invoice Amount. */
  balanceDue?: number | null;
  paidStamp?: boolean | null;
  isCredit?: boolean;
  extractedText?: string | null;
}): AmountPick {
  const keep: AmountPick = { amount: input.total, jobTotal: null, reason: null };
  const total = input.total;
  if (!valid(total) || total <= 0 || input.isCredit || input.paidStamp === true) return keep;

  const due = valid(input.balanceDue) && input.balanceDue > 0 ? input.balanceDue : dueFromText(input.extractedText);
  if (!valid(due) || due <= 0 || due >= total - 0.005) return keep;
  if (!PROGRESS_SIGNAL.test(input.extractedText ?? "")) return keep;

  const amount = Math.round(due * 100) / 100;
  return {
    amount,
    jobTotal: total,
    reason: `Job total ${money(total)}. This invoice asks for ${money(amount)}; earlier payments are subtracted.`,
  };
}
