/**
 * Penney's day is the Massachusetts day. "Today" used to be worked out in UTC
 * in four places in the sub portal, so after 8 PM ET (7 PM in winter) a
 * sub's post landed on tomorrow and today's phase dropped off his list.
 *
 * Every sub-portal date question goes through here: America/New_York via
 * Intl, so it is right on a Vercel server (UTC), on a phone in any time zone,
 * and across the DST changes. No dependencies.
 *
 * Calendar days are plain "YYYY-MM-DD" strings everywhere (same shape as a
 * Postgres `date`). Day arithmetic runs in UTC on those strings, so adding a
 * day never lands on 11 PM because of a clock change.
 */

export const ET_TIME_ZONE = "America/New_York";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

// One formatter, reused: building Intl formatters is the slow part.
const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** True for a plain calendar day like "2026-10-16". */
export function isCalendarDay(value: unknown): value is string {
  return typeof value === "string" && DAY_RE.test(value);
}

function toDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}

/** The ET wall clock for a moment: year, month (1-12), day, hour (0-23), minute, second. */
export function etParts(input: Date | string | number = new Date()) {
  const parts = PARTS.formatToParts(toDate(input));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Some engines print midnight as "24" even with h23.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The ET calendar day of a moment, as "YYYY-MM-DD".
 * A plain calendar day passes through unchanged (it already is a day), so
 * callers can hand in either a `date` column or a `timestamptz` column.
 * An unreadable value returns null.
 */
export function etDate(input: Date | string | number): string | null {
  if (isCalendarDay(input)) return input;
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return null;
  const p = etParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Today in Massachusetts, "YYYY-MM-DD". Pass `now` to test a specific moment. */
export function todayET(now: Date = new Date()): string {
  return etDate(now) as string;
}

/** The ET hour (0-23) right now, or at `now`. */
export function etHour(now: Date = new Date()): number {
  return etParts(now).hour;
}

/**
 * Is it at or past this ET time of day? `isAfterET(15)` is the 3 PM "add
 * today's photos" nudge; `isAfterET(17, 30)` the 5:30 PM digest.
 */
export function isAfterET(hour: number, minute = 0, now: Date = new Date()): boolean {
  const p = etParts(now);
  return p.hour * 60 + p.minute >= hour * 60 + minute;
}

/** Calendar math on a "YYYY-MM-DD" day: addDays("2026-10-31", 1) → "2026-11-01". */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `a` to `b` (b − a). daysBetween("2026-10-16", "2026-10-20") → 4. */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** Day of the week for a calendar day: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The Monday of the ET week a moment (or day) falls in, "YYYY-MM-DD".
 * Sub bills are dated by the week they were received, so this is
 * `sub_bill_submissions.received_week`.
 */
export function etMonday(input: Date | string | number = new Date()): string {
  const day = etDate(input) ?? todayET();
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

/**
 * Minutes ET is ahead of UTC at a moment (−240 in summer, −300 in winter).
 * Worked out from the wall clock, so it follows the DST rules Intl knows.
 */
function etOffsetMinutes(at: Date): number {
  const p = etParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant of midnight ET at the start of a calendar day. */
export function etStartOfDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes: the first offset is a guess from UTC midnight; the second is
  // read at the real ET midnight (clocks change at 2 AM, never at midnight).
  const first = guess - etOffsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess - etOffsetMinutes(new Date(first)) * 60_000);
}

/**
 * The [start, end) instants of an ET day as ISO strings, for querying a
 * timestamptz column: `.gte("started_at", start).lt("started_at", end)`.
 */
export function etDayRange(day: string): { start: string; end: string } {
  return {
    start: etStartOfDay(day).toISOString(),
    end: etStartOfDay(addDays(day, 1)).toISOString(),
  };
}

/** "7:12 AM" — the ET clock time of a moment. Empty string when unreadable. */
export function etTimeLabel(input: Date | string | number): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { timeZone: ET_TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

/** Does a phase running start → end (end may be null = one day) cover this day? */
export function coversDay(start: string | null, end: string | null, day: string): boolean {
  if (!start) return false;
  const last = end && end >= start ? end : start;
  return start <= day && day <= last;
}
