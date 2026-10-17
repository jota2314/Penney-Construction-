import type { ReactNode } from "react";
import { fmtShort, fmtWeekday, weekOf } from "@/lib/portal-kit/format";

/**
 * One row of a schedule timeline, copied from the client portal's Schedule
 * tab: a dot (or a diamond for an inspection), the name, a solid status
 * chip, and the dates — exact when the office confirmed them, "Week of …"
 * when they're only penciled in. Buttons (Confirm / Can't make it) go in
 * `actions`. Wrap rows in <TimelineList>.
 */

/** Chip colours, all readable with white text at 13px bold (darker than the client's grey/terracotta). */
export const TIMELINE_CHIP = {
  done: { label: "Done", color: "#2F6B4F" },
  now: { label: "In progress", color: "#9E4E28" },
  confirmed: { label: "Confirmed", color: "#252D2B" },
  penciled: { label: "Penciled in", color: "#5F6763" },
  answer: { label: "Answer needed", color: "#7A5A1E" },
  declined: { label: "Can't make it", color: "#8A2D10" },
  passed: { label: "Passed", color: "#2F6B4F" },
  failed: { label: "Failed", color: "#8A2D10" },
} as const;
export type TimelineChipKey = keyof typeof TIMELINE_CHIP;
export type TimelineChip = TimelineChipKey | { label: string; color: string };

/** "Mon Oct 19" or "Mon Oct 19 – Tue Oct 20". */
export function firmDates(start: string | null, end: string | null): string {
  if (!start) return "Date to be set";
  const one = (d: string) => `${fmtWeekday(d)} ${fmtShort(d)}`;
  return !end || end <= start ? one(start) : `${one(start)} – ${one(end)}`;
}

export function TimelineList({ children }: { children: ReactNode }) {
  return <ol className="card divide-y divide-[var(--line)]">{children}</ol>;
}

export function TimelineRow({
  name,
  description,
  shape = "dot",
  chip,
  filled = false,
  highlight = false,
  muted = false,
  start = null,
  end = null,
  firm = false,
  dateText,
  actions,
  children,
}: {
  name: string;
  description?: string | null;
  /** "diamond" for inspections. */
  shape?: "dot" | "diamond";
  chip: TimelineChip;
  /** Solid marker (done or happening now); hollow otherwise. */
  filled?: boolean;
  /** The warm tint for work happening now. */
  highlight?: boolean;
  /** Greys the name (past work). */
  muted?: boolean;
  start?: string | null;
  end?: string | null;
  /** Exact dates when true; "Week of …" when false. */
  firm?: boolean;
  /** Overrides the date line ("Passed Oct 15", "Penciled in · Penney will confirm"). */
  dateText?: string;
  /** Buttons under the row. */
  actions?: ReactNode;
  /** Extra lines (his answer, a note). */
  children?: ReactNode;
}) {
  const c = typeof chip === "string" ? TIMELINE_CHIP[chip] : chip;
  const dates = dateText ?? (firm ? firmDates(start, end) : weekOf(start));
  return (
    <li className={`flex gap-3 p-4 ${highlight ? "bg-[#FBF1EB]" : ""}`}>
      <span
        aria-hidden
        className={`mt-1.5 h-3.5 w-3.5 shrink-0 ${shape === "diamond" ? "rotate-45 rounded-[3px]" : "rounded-full"}`}
        style={{ background: filled ? c.color : "transparent", border: `2px solid ${c.color}` }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-[17px] font-bold leading-snug ${muted ? "text-[var(--muted)]" : ""}`}>{name}</p>
          <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-bold text-white" style={{ background: c.color }}>
            {c.label}
          </span>
        </div>
        {description && <p className="mt-0.5 text-[15px] text-[var(--muted)]">{description}</p>}
        <p className="mt-1 text-[15px] font-semibold text-[var(--muted)]">{dates}</p>
        {children}
        {actions && <div className="mt-3 flex flex-wrap gap-3">{actions}</div>}
      </div>
    </li>
  );
}
