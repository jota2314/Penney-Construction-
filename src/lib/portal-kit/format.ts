import { formatMoney } from "@/lib/money";
import { ET_TIME_ZONE, addDays, daysBetween, etDate, etTimeLabel, todayET } from "@/lib/sub-portal/et-day";

/**
 * Formatters shared by the portals (sub portal now, client portal in R3),
 * copied from client-portal-view.tsx and made time-zone proof.
 *
 * A plain day ("2026-10-16") is printed as that day on every device; a
 * timestamp is printed as its Massachusetts day. The client portal's own
 * copies print in the phone's zone, which is only right on a phone in ET.
 */

export { todayET };

/** Always to the cent: "$12,500.00". These figures mirror invoices and PDFs. */
export function fmtMoney(value: number | null | undefined, empty = "—"): string {
  return formatMoney(value, { cents: "always", empty });
}

/**
 * A day string as a Date at local midnight, same as the client portal's
 * parseDay (a timestamp string is parsed as-is). Prefer the fmt* helpers
 * for display; they don't depend on the phone's time zone.
 */
export function parseDay(d: string): Date {
  return new Date(d + (d.length === 10 ? "T00:00:00" : ""));
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Day strings are formatted at UTC noon in UTC, so no zone can shift them.
// Timestamps are formatted in ET.
function format(d: string, opts: Intl.DateTimeFormatOptions): string | null {
  if (DAY_RE.test(d)) {
    const date = new Date(`${d}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  }
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-US", { ...opts, timeZone: ET_TIME_ZONE });
}

/** "Oct 16, 2026". */
export function fmtDate(d: string | null | undefined, empty = "TBD"): string {
  return (d && format(d, { month: "short", day: "numeric", year: "numeric" })) || empty;
}

/** "Oct 16". */
export function fmtShort(d: string | null | undefined, empty = "TBD"): string {
  return (d && format(d, { month: "short", day: "numeric" })) || empty;
}

/** "Thu". */
export function fmtWeekday(d: string | null | undefined, empty = ""): string {
  return (d && format(d, { weekday: "short" })) || empty;
}

/** "7:12 AM", Massachusetts time. */
export function fmtTime(iso: string | null | undefined, empty = ""): string {
  return (iso && etTimeLabel(iso)) || empty;
}

/** Penciled-in dates get "week of" granularity, snapped to Monday: "Week of Oct 12". */
export function weekOf(d: string | null | undefined, empty = "Date to be set"): string {
  const day = d ? etDate(d) : null;
  if (!day) return empty;
  const [y, m, dd] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  return `Week of ${fmtShort(addDays(day, -((weekday + 6) % 7)))}`;
}

/** "Oct 16" or "Oct 16 – Oct 20" (a missing or earlier end means one day). */
export function fmtRange(start: string | null | undefined, end?: string | null, empty = "TBD"): string {
  if (!start) return empty;
  if (!end || end <= start) return fmtShort(start);
  return `${fmtShort(start)} – ${fmtShort(end)}`;
}

/** "Mon–Tue" or "Mon": for phases inside the coming week. */
export function fmtWeekdayRange(start: string | null | undefined, end?: string | null): string {
  if (!start) return "";
  if (!end || end <= start) return fmtWeekday(start);
  return `${fmtWeekday(start)}–${fmtWeekday(end)}`;
}

/**
 * "Today", "Yesterday", "Thu" (within the last week), else "Oct 12".
 * For lines like "Last post Thu". `today` defaults to the ET day.
 */
export function fmtRelativeDay(d: string | null | undefined, today: string = todayET(), empty = ""): string {
  const day = d ? etDate(d) : null;
  if (!day) return empty;
  const ago = daysBetween(day, today);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago > 1 && ago < 7) return fmtWeekday(day);
  return fmtShort(day);
}

/** "6.2 MB", "840 KB". */
export function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "978-621-4387" → "tel:9786214387". */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
