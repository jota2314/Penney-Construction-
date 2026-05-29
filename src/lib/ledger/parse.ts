/**
 * Pure ledger-parsing helpers + types. Kept separate from the server
 * actions file because a "use server" module may only export async
 * functions. These are imported by both the server action and the UI.
 *
 * The Drive ledger sheets are free-form, so parsing is tolerant: for
 * each row we find a date cell, the description, and a currency amount
 * (parentheses = negative). Deposits are detected by the word
 * "deposit"; everything else is an expense (signed amount).
 */

export interface LedgerEntry {
  id: string;
  entry_date: string | null;
  description: string | null;
  amount: number;
  direction: "deposit" | "expense";
  category: string | null;
  source: string;
}

export interface LedgerSummary {
  total_deposits: number;
  total_expenses: number;
  cash_balance: number;
  entry_count: number;
  last_entry_date: string | null;
  last_synced_at: string | null;
}

export interface ParsedRow {
  entry_date: string | null;
  description: string;
  amount: number;
  direction: "deposit" | "expense";
}

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

/** Parse "M/D/YY" or "M/D/YYYY" → ISO "YYYY-MM-DD" (null if not a date). */
export function parseLedgerDate(raw: string): string | null {
  const m = raw.trim().match(DATE_RE);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  let year = parseInt(yy, 10);
  if (yy.length === 2) year += year < 70 ? 2000 : 1900;
  const month = mm.padStart(2, "0");
  const day = dd.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parse a currency cell. Parentheses or leading minus = negative. */
export function parseLedgerAmount(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  const cleaned = t.replace(/[(),$\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Math.abs(parseFloat(cleaned));
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

/**
 * Turn raw sheet rows into ledger entries. Skips header/total/notes
 * rows (anything without a real date + amount).
 */
export function parseLedgerRows(rows: string[][]): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const row of rows) {
    if (!row || row.length === 0) continue;

    // Find the date cell.
    let dateIdx = -1;
    let isoDate: string | null = null;
    for (let i = 0; i < row.length; i++) {
      const d = parseLedgerDate(row[i] || "");
      if (d) {
        dateIdx = i;
        isoDate = d;
        break;
      }
    }
    if (dateIdx === -1) continue;

    // First currency cell after the date.
    let amount: number | null = null;
    let amountIdx = -1;
    for (let i = dateIdx + 1; i < row.length; i++) {
      const a = parseLedgerAmount(row[i] || "");
      if (a !== null) {
        amount = a;
        amountIdx = i;
        break;
      }
    }
    if (amount === null) continue;

    // Description = text between the date and the amount.
    const descParts: string[] = [];
    for (let i = dateIdx + 1; i < amountIdx; i++) {
      const c = (row[i] || "").trim();
      if (c) descParts.push(c);
    }
    const description = descParts.join(" ").trim() || "(no description)";

    const direction: "deposit" | "expense" =
      /deposit/i.test(description) && amount > 0 ? "deposit" : "expense";

    out.push({ entry_date: isoDate, description, amount, direction });
  }
  return out;
}
