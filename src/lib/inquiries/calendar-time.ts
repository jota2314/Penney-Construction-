import { addDays, etDate, etParts, etStartOfDay, todayET, weekdayOf } from "@/lib/sub-portal/et-day";

export const WALKTHROUGH_TIME_ZONE = "America/New_York" as const;
export const WALKTHROUGH_DURATION_MINUTES = 60 as const;
export const WALKTHROUGH_BUFFER_MINUTES = 30;
export const WALKTHROUGH_NOTICE_HOURS = 24;
export const WALKTHROUGH_HORIZON_DAYS = 60;
export const WALKTHROUGH_WINDOW_DAYS = 14;
export type CalendarInterval = { start: string; end: string };

/** Strict day validation: Date alone rolls February 31 into March. */
export function validCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validAvailabilityDay(value: unknown, now = Date.now()): value is string {
  return validCalendarDay(value) && value >= todayET(new Date(now)) &&
    value <= addDays(todayET(new Date(now)), WALKTHROUGH_HORIZON_DAYS);
}

/** Resolve daytime wall-clock times through Intl, including DST boundary weeks. */
export function easternTime(day: string, hour: number, minute = 0): string {
  if (!validCalendarDay(day) || !Number.isInteger(hour) || hour < 0 || hour > 23 ||
    !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("Invalid calendar time.");
  const [year, month, date] = day.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  let resolved = wall;
  for (let i = 0; i < 3; i++) {
    const parts = etParts(resolved);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    resolved += wall - asUtc;
  }
  const parts = etParts(resolved);
  if (etDate(resolved) !== day || parts.hour !== hour || parts.minute !== minute) throw new Error("This local time does not exist.");
  return new Date(resolved).toISOString();
}

export function availabilityRange(fromDay: string): CalendarInterval {
  return { start: etStartOfDay(fromDay).toISOString(), end: etStartOfDay(addDays(fromDay, WALKTHROUGH_WINDOW_DAYS)).toISOString() };
}

export function overlapsWithTravel(slot: CalendarInterval, busy: CalendarInterval[]): boolean {
  const start = Date.parse(slot.start) - WALKTHROUGH_BUFFER_MINUTES * 60_000;
  const end = Date.parse(slot.end) + WALKTHROUGH_BUFFER_MINUTES * 60_000;
  return busy.some((item) => Date.parse(item.start) < end && Date.parse(item.end) > start);
}

export function walkthroughSlots(fromDay: string, busy: CalendarInterval[], now = Date.now()): CalendarInterval[] {
  if (!validAvailabilityDay(fromDay, now)) return [];
  const slots: CalendarInterval[] = [];
  const lastDay = addDays(todayET(new Date(now)), WALKTHROUGH_HORIZON_DAYS);
  const earliest = now + WALKTHROUGH_NOTICE_HOURS * 3_600_000;
  for (let offset = 0; offset < WALKTHROUGH_WINDOW_DAYS; offset++) {
    const day = addDays(fromDay, offset);
    if (day > lastDay || weekdayOf(day) === 0 || weekdayOf(day) === 6) continue;
    // Suggested visit windows, awaiting Ryan's explicit confirmation.
    for (let minutes = 9 * 60; minutes <= 15 * 60; minutes += 30) {
      const start = easternTime(day, Math.floor(minutes / 60), minutes % 60);
      const slot = { start, end: new Date(Date.parse(start) + WALKTHROUGH_DURATION_MINUTES * 60_000).toISOString() };
      if (Date.parse(start) >= earliest && !overlapsWithTravel(slot, busy)) slots.push(slot);
    }
  }
  return slots;
}

/** Always validate stored timestamps, even if they came from the public picker. */
export function validWalkthroughSlot(start: unknown, end: unknown, now = Date.now()): start is string {
  if (typeof start !== "string" || typeof end !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start) ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(end)) return false;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs !== WALKTHROUGH_DURATION_MINUTES * 60_000) return false;
  const day = etDate(startMs);
  if (!day || !validAvailabilityDay(day, now)) return false;
  return walkthroughSlots(day, [], now).some((slot) => Date.parse(slot.start) === startMs && Date.parse(slot.end) === endMs);
}
