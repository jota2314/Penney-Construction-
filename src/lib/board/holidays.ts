/**
 * The days Penney doesn't swing a hammer.
 *
 * Computed per year rather than typed out, so the board keeps telling the
 * truth in 2027 without anyone remembering to edit a list.
 *
 * `closed` is the distinction that matters on the crew board. Penney shuts
 * down for seven of these — nobody is on a roof on Thanksgiving. The rest are
 * federal or Massachusetts holidays that a residential GC works straight
 * through; they show as a quiet note so Jorge knows why a sub might not
 * answer the phone, not as a blocked-off day.
 */

export interface Holiday {
  date: string;
  name: string;
  /** No crew, no subs — the day is off. */
  closed: boolean;
}

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The n-th `weekday` of a month; n = -1 means the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  if (n > 0) {
    const first = new Date(year, month - 1, 1).getDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const last = new Date(year, month, 0);
  return last.getDate() - ((last.getDay() - weekday + 7) % 7);
}

/**
 * A fixed-date federal holiday lands on the nearest weekday when it falls on
 * one — Saturday shifts back to Friday, Sunday forward to Monday.
 */
function observed(year: number, month: number, day: number) {
  const dow = new Date(year, month - 1, day).getDay();
  if (dow === 6) return iso(year, month, day - 1);
  if (dow === 0) return iso(year, month, day + 1);
  return iso(year, month, day);
}

function holidaysIn(year: number): Holiday[] {
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  return [
    { date: observed(year, 1, 1), name: "New Year's Day", closed: true },
    { date: iso(year, 1, nthWeekday(year, 1, 1, 3)), name: "MLK Day", closed: false },
    { date: iso(year, 2, nthWeekday(year, 2, 1, 3)), name: "Presidents' Day", closed: false },
    { date: iso(year, 4, nthWeekday(year, 4, 1, 3)), name: "Patriots' Day", closed: false },
    { date: iso(year, 5, nthWeekday(year, 5, 1, -1)), name: "Memorial Day", closed: true },
    { date: observed(year, 6, 19), name: "Juneteenth", closed: false },
    { date: observed(year, 7, 4), name: "July 4th", closed: true },
    { date: iso(year, 9, nthWeekday(year, 9, 1, 1)), name: "Labor Day", closed: true },
    { date: iso(year, 10, nthWeekday(year, 10, 1, 2)), name: "Columbus Day", closed: false },
    { date: observed(year, 11, 11), name: "Veterans Day", closed: false },
    { date: iso(year, 11, thanksgiving), name: "Thanksgiving", closed: true },
    { date: iso(year, 11, thanksgiving + 1), name: "Day after Thanksgiving", closed: true },
    { date: iso(year, 12, 24), name: "Christmas Eve", closed: false },
    { date: observed(year, 12, 25), name: "Christmas", closed: true },
  ];
}

/**
 * Every holiday between two ISO dates, keyed by date. Spans a year boundary
 * because the board's six-week window regularly does around New Year's.
 */
export function holidaysBetween(startStr: string, endStr: string): Map<string, Holiday> {
  const out = new Map<string, Holiday>();
  const first = Number(startStr.slice(0, 4));
  const last = Number(endStr.slice(0, 4));
  for (let y = first; y <= last; y++) {
    for (const h of holidaysIn(y)) {
      if (h.date >= startStr && h.date <= endStr) out.set(h.date, h);
    }
  }
  return out;
}
