/**
 * Money typed by hand is kept to the penny — Jorge, 10/1/2026: "Everything
 * needs to be to the penny if you edit it manually."
 *
 * Two ways cents used to get lost:
 *  - number boxes with no `step` (or step="100") only accept whole steps, so a
 *    browser refuses 1,234.56, and plain Number("1,250.50") is NaN — several
 *    forms turned a typed comma into $0
 *  - whole-dollar formatters printed a $1,234.56 change order as $1,235, so the
 *    client and the books disagreed by the cents that were typed
 *
 * `MONEY_INPUT` is the attribute set for a dollar box; `parseMoney` reads what
 * people actually type; `formatMoney` shows exact cents whenever there are any.
 */

/** Round to the cent. The epsilon keeps 1.005 from flooring to 1.00. */
export function roundCents(n: number): number {
  return Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
}

/**
 * "$1,250.50", "1250.5", " 12 ", "(42.10)" → dollars to the cent.
 * Blank or unreadable → null (callers decide whether that means 0 or "required").
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? roundCents(input) : null;
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$\s,]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return roundCents(negative ? -n : n);
}

/**
 * Exact dollars: "$12,500" when there are no cents, "$1,234.56" when there are.
 * `always` forces two decimals ("$12,500.00") for ledgers and invoices.
 */
export function formatMoney(
  value: number | null | undefined,
  opts: { cents?: "auto" | "always"; empty?: string } = {},
): string {
  if (value == null || !Number.isFinite(value)) return opts.empty ?? "—";
  const rounded = roundCents(value);
  const hasCents = Math.round(Math.abs(rounded) * 100) % 100 !== 0;
  const digits = opts.cents === "always" || hasCents ? 2 : 0;
  return rounded.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Unsigned, no "$" — for PDFs and pages that print their own sign/symbol. */
export function formatMoneyNumber(value: number): string {
  const rounded = roundCents(Math.abs(value));
  const digits = Math.round(rounded * 100) % 100 !== 0 ? 2 : 0;
  return rounded.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Spread onto a dollar <input type="number">: cents allowed, decimal keypad. */
export const MONEY_INPUT = { step: "0.01", inputMode: "decimal" } as const;
