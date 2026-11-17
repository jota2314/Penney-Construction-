import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { coversDay } from "@/lib/sub-portal/et-day";
import { fmtDate } from "@/lib/portal-kit/format";
import type { SubDatePhase } from "@/lib/sub-portal/payload";

export function isConfirmedWorkday(phase: SubDatePhase, day: string) {
  return phase.firm && phase.status !== "on_hold" && phase.sub_response !== "declined"
    && coversDay(phase.start_date, phase.end_date, day);
}

/** Only firm work gets a calendar day. Penciled-in work stays in the weekly timeline. */
export function ScheduleCalendar({ today, phases, selected, onSelect }: {
  today: string;
  phases: SubDatePhase[];
  selected: string | null;
  onSelect: (day: string | null) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [year, month] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const prefix = first.toISOString().slice(0, 7);
  const monthName = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const days = new Date(Date.UTC(year, month + offset, 0)).getUTCDate();
  const blanks = (first.getUTCDay() + 6) % 7;
  const shift = (step: number) => {
    setOffset(offset + step);
    onSelect(null);
  };
  return (
    <section aria-label="Confirmed workdays calendar" className="card min-w-0 self-start p-3.5 sm:p-4 lg:p-5">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
        className="flex min-h-11 w-full items-center gap-2 text-left font-bold lg:hidden">
        <CalendarDays aria-hidden className="size-5 text-[var(--accent-dark)]" />Confirmed workdays
        <ChevronDown aria-hidden className={`ml-auto size-4 ${expanded ? "rotate-180" : ""}`} />
      </button>
      <div className={`${expanded ? "block" : "hidden"} lg:block`}>
        <p className="hidden items-center gap-2 text-sm font-bold text-[var(--accent-dark)] lg:flex">
          <CalendarDays aria-hidden className="size-4" />Confirmed workdays
        </p>
        <div className="mt-1 flex items-center justify-between gap-1">
          <h2 aria-live="polite" className="text-lg font-extrabold tracking-tight">{monthName}</h2>
          <div className="flex">
            <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="grid size-11 place-items-center rounded-lg hover:bg-[var(--paper)]"><ChevronLeft aria-hidden className="size-4" /></button>
            <button type="button" onClick={() => shift(1)} aria-label="Next month" className="grid size-11 place-items-center rounded-lg hover:bg-[var(--paper)]"><ChevronRight aria-hidden className="size-4" /></button>
          </div>
        </div>
        <div className="mt-1 grid grid-cols-7 text-center tabular-nums">
          {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => <span aria-hidden key={i} className="py-1.5 text-xs font-semibold text-[var(--muted)]">{day}</span>)}
          {Array.from({ length: blanks }, (_, i) => <span key={`blank-${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const day = `${prefix}-${String(i + 1).padStart(2, "0")}`;
            const hasWork = phases.some((phase) => isConfirmedWorkday(phase, day));
            const chosen = selected === day;
            return (
              <button key={day} type="button" disabled={!hasWork}
                aria-label={`${fmtDate(day)}${hasWork ? ", show confirmed work" : ", no confirmed work"}`}
                aria-pressed={chosen} aria-current={day === today ? "date" : undefined}
                onClick={() => onSelect(chosen ? null : day)}
                className={`relative grid min-h-11 place-items-center rounded-lg text-sm ${chosen ? "bg-[var(--ink)] font-extrabold text-white" : hasWork ? "bg-[#FAEEE7] font-extrabold text-[var(--accent-dark)] hover:bg-[#F2DCCD]" : "text-[var(--muted)]"} ${day === today ? "ring-1 ring-inset ring-[var(--accent-dark)]" : ""}`}>
                {i + 1}
                {hasWork && <span aria-hidden className="absolute bottom-1.5 size-1 rounded-full bg-current" />}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
