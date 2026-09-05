/** Calendar dates use the company's timezone, independently of the device. */
export function crewToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  });
}

export function scheduleDays(start: string, count = 14): string[] {
  const date = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(date);
    day.setUTCDate(date.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

export function workOnDate<T extends { start_date: string; end_date: string }>(phases: T[], date: string): T[] {
  return phases.filter((phase) => phase.start_date <= date && phase.end_date >= date);
}

export function scheduleDateLabel(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}
