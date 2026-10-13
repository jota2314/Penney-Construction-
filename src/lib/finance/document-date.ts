/**
 * Scanned bills and receipts: the model reads the month and day right but
 * guesses the YEAR when it is faded, cut off, two-digit or not printed at all.
 * 405 Pub's "2026-08-21" came back 2025, Aubuchon's "09/04/26" came back 2023,
 * a Shopify "Sep 13" came back 2024, and those wrong years went on to QBO.
 *
 * Paperwork is handed in close to when it happened. So when the date read is
 * implausibly far from the day it was scanned, and the same month/day in the
 * scan year (or the year before, for a December bill scanned in January) lands
 * in the recent past, that is the date it was.
 */

const DAY_MS = 86_400_000;
/** Older than this, the year read is suspect. A real bill this old is rare. */
const MAX_PLAUSIBLE_AGE_DAYS = 300;
/** A corrected date must land within this many days before the scan… */
const MAX_CORRECTED_AGE_DAYS = 90;
/** …or at most this many days after it (timezone slack, post-dated invoices). */
const MAX_FUTURE_DAYS = 7;

function parseYmd(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Rejects 2026-02-30 and friends instead of letting Date roll them over.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

const ageDays = (date: number, today: number) => Math.round((today - date) / DAY_MS);

export interface ScannedDate {
  date: string | null;
  /** The date as the model read it, when it was changed. */
  readAs: string | null;
}

/**
 * @param read  the date the model returned (YYYY-MM-DD or anything else)
 * @param today the scan day, YYYY-MM-DD in the company timezone
 */
export function correctScannedYear(read: string | null | undefined, today: string): ScannedDate {
  if (typeof read !== "string") return { date: null, readAs: null };
  const date = parseYmd(read);
  const now = parseYmd(today);
  if (date === null) return { date: null, readAs: null };
  if (now === null) return { date: read, readAs: null };

  const age = ageDays(date, now);
  if (age >= -MAX_FUTURE_DAYS && age <= MAX_PLAUSIBLE_AGE_DAYS) return { date: read, readAs: null };

  const thisYear = Number(today.slice(0, 4));
  const monthDay = read.slice(4); // "-MM-DD"
  for (const year of [thisYear, thisYear - 1]) {
    const candidate = `${year}${monthDay}`;
    const t = parseYmd(candidate);
    if (t === null || candidate === read) continue;
    const candidateAge = ageDays(t, now);
    if (candidateAge >= -MAX_FUTURE_DAYS && candidateAge <= MAX_CORRECTED_AGE_DAYS) {
      return { date: candidate, readAs: read };
    }
  }
  return { date: read, readAs: null };
}

/** Prompt line telling the reader what year it is and how to read short years. */
export function scanDatePromptNote(today: string): string {
  const year = today.slice(0, 4);
  return `Today is ${today}. Paperwork handed in is almost always from the last few weeks. A two-digit year like "${year.slice(2)}" means ${year}. If the year is faded, cut off or not printed, use the most recent year that does not put the date after today — never an older year.`;
}
