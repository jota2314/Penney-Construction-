// Shared time-range helpers. Lives outside "use server" files so both
// server pages and the command-center aggregator can import it.

export type TimeRange = "week" | "month" | "quarter" | "year";

export interface PeriodInfo {
  range: TimeRange;
  offset: number;
  start: string; // ISO
  end: string;   // ISO
  label: string;
  isCurrent: boolean;
}

// offset=0 means current, -1 = previous period, etc.
export function computePeriod(range: TimeRange, offset: number, nowET: Date): PeriodInfo {
  let start: Date;
  let end: Date;
  let label: string;

  if (range === "week") {
    const d = new Date(nowET);
    const dow = (d.getDay() + 6) % 7; // Mon=0
    d.setDate(d.getDate() - dow + offset * 7);
    d.setHours(0, 0, 0, 0);
    start = new Date(d);
    end = new Date(d);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const fmt = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const prefix = offset === 0 ? "This week" : offset === -1 ? "Last week" : offset === 1 ? "Next week" : offset < 0 ? `${Math.abs(offset)} weeks ago` : `${offset} weeks from now`;
    label = `${prefix} · ${fmt(start)} – ${fmt(end)}`;
  } else if (range === "month") {
    start = new Date(nowET.getFullYear(), nowET.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthLabel = start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const prefix = offset === 0 ? "This month" : offset === -1 ? "Last month" : offset === 1 ? "Next month" : offset < 0 ? `${Math.abs(offset)} months ago` : `${offset} months from now`;
    label = `${prefix} · ${monthLabel}`;
  } else if (range === "quarter") {
    const currentQStart = Math.floor(nowET.getMonth() / 3) * 3;
    start = new Date(nowET.getFullYear(), currentQStart + offset * 3, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 3, 0, 23, 59, 59, 999);
    const qNum = Math.floor(start.getMonth() / 3) + 1;
    const qLabel = `Q${qNum} ${start.getFullYear()}`;
    const prefix = offset === 0 ? "This quarter" : offset === -1 ? "Last quarter" : offset === 1 ? "Next quarter" : offset < 0 ? `${Math.abs(offset)} quarters ago` : `${offset} quarters from now`;
    label = `${prefix} · ${qLabel}`;
  } else {
    start = new Date(nowET.getFullYear() + offset, 0, 1);
    end = new Date(nowET.getFullYear() + offset, 11, 31, 23, 59, 59, 999);
    const prefix = offset === 0 ? "This year" : offset === -1 ? "Last year" : offset === 1 ? "Next year" : offset < 0 ? `${Math.abs(offset)} years ago` : `${offset} years from now`;
    label = `${prefix} · ${start.getFullYear()}`;
  }

  return {
    range,
    offset,
    start: start.toISOString(),
    end: end.toISOString(),
    label,
    isCurrent: offset === 0,
  };
}
