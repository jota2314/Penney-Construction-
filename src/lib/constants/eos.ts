import type { LucideIcon } from "lucide-react";
import {
  MessageSquare,
  LineChart,
  Mountain,
  Megaphone,
  ListChecks,
  Wrench,
  Flag,
} from "lucide-react";

/**
 * The Level 10 Meeting agenda, straight out of EOS. Same seven
 * sections, same time boxes, every week, same day, same time.
 * Total = 90 minutes.
 */
export interface L10Section {
  key: string;
  label: string;
  minutes: number;
  icon: LucideIcon;
  /** Shown in the runner so whoever is facilitating knows the drill. */
  prompt: string;
}

export const L10_SECTIONS: L10Section[] = [
  {
    key: "segue",
    label: "Segue",
    minutes: 5,
    icon: MessageSquare,
    prompt:
      "Round the room: one personal best and one business best from the last 7 days. No discussion, no problem solving.",
  },
  {
    key: "scorecard",
    label: "Scorecard",
    minutes: 5,
    icon: LineChart,
    prompt:
      "Read the numbers only. Any measurable off its goal is not discussed here — drop it on the issues list.",
  },
  {
    key: "rocks",
    label: "Rock Review",
    minutes: 5,
    icon: Mountain,
    prompt:
      "Each owner says on-track or off-track. Off-track goes to the issues list. No discussion.",
  },
  {
    key: "headlines",
    label: "Headlines",
    minutes: 5,
    icon: Megaphone,
    prompt:
      "Customer and employee headlines. Good news and bad news, one line each. Anything needing action becomes an issue or a to-do.",
  },
  {
    key: "todos",
    label: "To-Do List",
    minutes: 5,
    icon: ListChecks,
    prompt:
      "Last week's to-dos: done or not done. Target is 90% done. Not-done items carry over or become issues.",
  },
  {
    key: "ids",
    label: "IDS",
    minutes: 60,
    icon: Wrench,
    prompt:
      "Identify, Discuss, Solve. Prioritise the top three issues, then solve them one at a time. Every solve becomes a to-do.",
  },
  {
    key: "conclude",
    label: "Conclude",
    minutes: 5,
    icon: Flag,
    prompt:
      "Recap the new to-dos, agree the cascading message, and everyone rates the meeting 1-10.",
  },
];

export const L10_TOTAL_MINUTES = L10_SECTIONS.reduce(
  (sum, section) => sum + section.minutes,
  0,
);

export function l10Section(key: string | null | undefined): L10Section | undefined {
  return L10_SECTIONS.find((section) => section.key === key);
}

// ── Rocks ───────────────────────────────────────────────────────

export const ROCK_STATUS_LABELS = {
  on_track: "On track",
  off_track: "Off track",
  complete: "Complete",
  incomplete: "Incomplete",
} as const;

export const ROCK_STATUS_CLASSES = {
  on_track: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  off_track: "bg-red-500/15 text-red-500 border-red-500/30",
  complete: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  incomplete: "bg-muted text-muted-foreground border-border",
} as const;

// ── Issues / To-dos ─────────────────────────────────────────────

export const ISSUE_TERM_LABELS = {
  short_term: "Short term",
  long_term: "Long term",
} as const;

export const ISSUE_STATUS_LABELS = {
  open: "Open",
  solved: "Solved",
  dropped: "Dropped",
} as const;

export const TODO_STATUS_LABELS = {
  open: "Open",
  done: "Done",
  dropped: "Dropped",
} as const;

// ── Scorecard formatting ────────────────────────────────────────

export const UNIT_LABELS = {
  number: "Number",
  currency: "Dollars",
  percentage: "Percent",
  yes_no: "Yes / No",
  duration: "Days",
} as const;

export type EosUnit = keyof typeof UNIT_LABELS;

export function formatMeasurable(
  value: number | null | undefined,
  unit: EosUnit,
): string {
  if (value === null || value === undefined) return "—";

  switch (unit) {
    case "currency":
      return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
    case "percentage":
      return `${Number(value.toFixed(1))}%`;
    case "yes_no":
      return value ? "Yes" : "No";
    case "duration":
      return `${Number(value.toFixed(1))}d`;
    default:
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
}

/**
 * Did this week's number hit the goal? `null` when there is no score
 * yet, or when the measurable has no agreed goal — several of Penney's
 * came out of Focus Day as "TBD, set at L10" and must not read as a miss.
 */
export function isOnGoal(
  value: number | null | undefined,
  goal: number | null | undefined,
  comparison: string,
): boolean | null {
  if (value === null || value === undefined) return null;
  if (goal === null || goal === undefined) return null;

  switch (comparison) {
    case ">=":
      return value >= goal;
    case "<=":
      return value <= goal;
    case ">":
      return value > goal;
    case "<":
      return value < goal;
    case "=":
      return value === goal;
    default:
      return null;
  }
}

// ── Scorecard weeks ─────────────────────────────────────────────

/**
 * Scorecard weeks are keyed by the Sunday that ends them, so every
 * client and server path agrees on which column a number lands in.
 */
export function weekEnding(date: Date = new Date()): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()) % 7);
  return d.toISOString().slice(0, 10);
}

/** The last `count` week-ending dates, oldest first. */
export function recentWeeks(count = 13, from: Date = new Date()): string[] {
  const end = new Date(`${weekEnding(from)}T00:00:00Z`);
  const weeks: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.push(d.toISOString().slice(0, 10));
  }
  return weeks;
}

export function formatWeekLabel(weekEndingDate: string): string {
  const d = new Date(`${weekEndingDate}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** Current quarter in the form Rocks are stored as, e.g. "Q3 2026". */
export function currentQuarter(date: Date = new Date()): string {
  return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
}
