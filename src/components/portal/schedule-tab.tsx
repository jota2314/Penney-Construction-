"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PortalPhase } from "@/lib/portal/types";

// The homeowner's Schedule tab: a timeline (Gantt) of the master phases and a
// plain dated list. Both read the same client-safe phase fields the portal
// loader returns (name, dates, status) — never notes, crew or sub names.

export interface PhaseActions {
  act: (kind: "phase", id: string, action: string) => void | Promise<void>;
  busy: string | null;
  enabled: boolean;
}

type View = "timeline" | "list";
type Scale = "week" | "month";
type StateKey = "done" | "verifying" | "in_progress" | "on_hold" | "confirmed" | "estimated";

// Same colors as the list chips. "Upcoming" is confirmed (solid) or estimated
// (dashed outline) depending on whether the date is locked with our trades.
const STATES: Record<StateKey, { label: string; color: string }> = {
  done: { label: "Done", color: "#2F6B4F" },
  verifying: { label: "Awaiting verification", color: "#7A5A1E" },
  in_progress: { label: "In progress", color: "#C66638" },
  on_hold: { label: "On hold", color: "#6E6A62" },
  confirmed: { label: "Confirmed", color: "#252D2B" },
  estimated: { label: "Estimated", color: "#8A918C" },
};
const LEGEND: { key: StateKey; label: string }[] = [
  { key: "done", label: "Done" },
  { key: "verifying", label: "Awaiting verification" },
  { key: "in_progress", label: "In progress" },
  { key: "confirmed", label: "Upcoming · confirmed" },
  { key: "estimated", label: "Upcoming · estimated" },
  { key: "on_hold", label: "On hold" },
];

function phaseState(p: PortalPhase): StateKey {
  if (p.status === "completed") return "done";
  if (p.client_completed) return "verifying";
  if (p.status === "on_hold") return "on_hold";
  if (p.status === "in_progress") return "in_progress";
  return p.firm ? "confirmed" : "estimated";
}

const VIEW_KEY = "pc-portal-schedule-view";
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

// Day numbers (days since 1970-01-01, UTC) keep the chart math free of DST.
const DAY = 86_400_000;
const toDay = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY);
const dayDate = (n: number) => new Date(n * DAY);
const fmtDay = (n: number, opts: Intl.DateTimeFormatOptions) => dayDate(n).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const mondayOf = (n: number) => n - ((n + 3) % 7); // day 0 was a Thursday
const monthStart = (n: number) => { const d = dayDate(n); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY; };
const nextMonth = (n: number) => { const d = dayDate(n); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY; };

// "Nov 16", or "Jan 15, 2027" outside the current year.
function shortDate(d: string, year: string) {
  return fmtDay(toDay(d), d.slice(0, 4) === year ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
function dateText(p: PortalPhase, year: string) {
  if (p.actual_completion_date) return `Passed ${shortDate(p.actual_completion_date, year)}`;
  if (!p.start_date) return "Date to be set";
  const end = p.end_date ?? p.start_date;
  if (end === p.start_date) return shortDate(p.start_date, year);
  // "Jan 4 – Jan 15, 2027": the year once, on the end date.
  const startYear = p.start_date.slice(0, 4);
  return `${shortDate(p.start_date, startYear === end.slice(0, 4) ? startYear : year)} – ${shortDate(end, year)}`;
}

// Chronological, which is how a homeowner reads a schedule.
function byDate(a: PortalPhase, b: PortalPhase) {
  return (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999") ||
    (a.end_date ?? "").localeCompare(b.end_date ?? "") ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

export function ScheduleTab({ phases, action }: { phases: PortalPhase[]; action: PhaseActions }) {
  // The tab only renders in the browser (portal data loads after mount).
  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "timeline"; } catch { return "timeline"; }
  });
  const today = todayISO();
  const rows = useMemo(() => [...phases].sort(byDate), [phases]);

  function pick(v: View) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ }
  }

  if (rows.length === 0) {
    return <div className="card p-6 text-center text-[15px] text-[var(--muted)]">Your project timeline will appear here once it&apos;s scheduled.</div>;
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Schedule view" className="inline-flex rounded-full border border-[var(--line)] bg-white p-1">
          {([["timeline", "Timeline"], ["list", "List"]] as [View, string][]).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={view === key} onClick={() => pick(key)}
              className={`min-h-[36px] rounded-full px-4 text-[14px] font-bold ${view === key ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-[var(--muted)]">Today · {shortDate(today, "")}</p>
      </div>
      <p className="px-1 text-[14px] leading-relaxed text-[var(--muted)]">
        <b className="text-[var(--ink)]">Confirmed</b> dates are locked with our trades. <b className="text-[var(--ink)]">Estimated</b> dates firm up as work gets closer.
      </p>
      {view === "timeline" ? <ScheduleGantt rows={rows} today={today} /> : <ScheduleList rows={rows} today={today} action={action} />}
    </>
  );
}

// ─────────────────────────────── List
function ScheduleList({ rows, today, action }: { rows: PortalPhase[]; today: string; action: PhaseActions }) {
  const year = today.slice(0, 4);
  return (
    <ol className="card divide-y divide-[var(--line)]">
      {rows.map((p) => {
        const state = phaseState(p);
        const { label, color } = STATES[state];
        const isDone = state === "done";
        const isNow = state === "in_progress";
        // The client can tick off work that has started; future and paused phases stay the team's.
        const canMark = isNow || ((state === "confirmed" || state === "estimated") && !!p.start_date && p.start_date <= today);
        const busy = action.busy === `phase:${p.id}`;
        const isInspection = p.event_type === "inspection";
        return (
          <li key={p.id} className={`flex gap-3 p-4 ${isNow ? "bg-[#FBF1EB]" : ""}`}>
            <span className={`mt-1 h-3.5 w-3.5 shrink-0 ${isInspection ? "rotate-45 rounded-[3px]" : "rounded-full"}`}
              style={{ background: isDone || isNow ? color : "transparent", border: `2px solid ${color}` }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className={`text-[16px] font-bold ${isDone ? "text-[var(--muted)]" : ""}`}>{p.name}</p>
                <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold text-white" style={{ background: color }}>{label}</span>
              </div>
              <p className="mt-1 text-[14px] font-semibold text-[var(--muted)]">{dateText(p, year)}</p>
              {state === "verifying" && (
                <div className="mt-2 flex items-center gap-3 text-[14px]">
                  <span className="font-semibold text-[#7A5A1E]">You reported this complete — awaiting team verification</span>
                  <button disabled={!action.enabled || busy} onClick={() => action.act("phase", p.id, "uncomplete")}
                    className="min-h-[36px] font-bold text-[var(--accent-dark)] disabled:opacity-50">{busy ? "Saving…" : "Undo"}</button>
                </div>
              )}
              {canMark && (
                <button disabled={!action.enabled || busy} onClick={() => action.act("phase", p.id, "complete")}
                  className="btn btn-ghost mt-2 disabled:opacity-50">{busy ? "Saving…" : "✓ Mark complete"}</button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─────────────────────────────── Timeline (Gantt)
const ROW_H = 48;
const HEAD_H = 48;
const END_PAD = 112; // room for the date label after the last bar
const WEEK_PX = 7;   // px per day on the week scale (49px a week)
const MONTH_MIN_PX = 2.4;

function barStyle(state: StateKey): React.CSSProperties {
  const { color } = STATES[state];
  if (state === "estimated") return { background: "#EEEFEC", border: `2px dashed ${color}` };
  if (state === "on_hold") return { background: "repeating-linear-gradient(135deg,#D9D3C8 0 4px,#F4F1EC 4px 8px)", border: `1.5px solid ${color}` };
  return { background: color };
}

function ScheduleGantt({ rows, today }: { rows: PortalPhase[]; today: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const year = today.slice(0, 4);
  const dated = rows.filter((p) => p.start_date);
  const undated = rows.filter((p) => !p.start_date);

  const todayN = toDay(today);
  const first = dated.length ? Math.min(...dated.map((p) => toDay(p.start_date!))) : todayN;
  const last = dated.length ? Math.max(...dated.map((p) => toDay(p.end_date ?? p.start_date!))) : todayN;
  // Show the today line when it is near the work; a job months away just starts the chart at its own start.
  const withToday = todayN >= first - 45 && todayN <= last + 45;
  const lo = withToday ? Math.min(first, todayN) : first;
  const hi = withToday ? Math.max(last, todayN) : last;

  const [scale, setScale] = useState<Scale>(hi - lo <= 84 ? "week" : "month");

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const labelW = width >= 560 ? 208 : 132;
  const start = scale === "week" ? mondayOf(lo) : monthStart(lo);
  const end = scale === "week" ? mondayOf(hi) + 7 : nextMonth(hi); // exclusive
  const days = end - start;
  const fit = (width || 343) - labelW - END_PAD;
  const px = scale === "week" ? WEEK_PX : Math.max(MONTH_MIN_PX, fit / days);
  const innerW = Math.round(days * px) + END_PAD;
  const x = (n: number) => (n - start) * px;
  const todayX = withToday ? x(todayN) + px / 2 : null;

  // Header: months over week starts (week scale) or years over months (month scale).
  const ticks: { n: number; label: string; major: boolean }[] = [];
  const tops: { n: number; label: string }[] = [];
  if (scale === "week") {
    // Week labels carry the month so a chart scrolled to mid-month still reads.
    for (let n = start; n < end; n += 7) ticks.push({ n, label: fmtDay(n, { month: "short", day: "numeric" }), major: false });
    for (let n = monthStart(start); n < end; n = nextMonth(n)) {
      tops.push({ n: Math.max(n, start), label: fmtDay(n, { month: "long", year: "numeric" }) });
      if (n > start) ticks.push({ n, label: "", major: true });
    }
  } else {
    for (let n = start; n < end; n = nextMonth(n)) {
      const jan = dayDate(n).getUTCMonth() === 0;
      ticks.push({ n, label: fmtDay(n, { month: "short" }), major: jan });
      if (n === start || jan) tops.push({ n, label: fmtDay(n, { year: "numeric" }) });
    }
  }
  // A chart that opens late in a month would print that month over the next one.
  const labelEnd = (n: number, text: string) => x(n) + 6 + text.length * 7.5;
  if (tops.length > 1 && labelEnd(tops[0].n, tops[0].label) + 8 > x(tops[1].n)) tops.shift();
  // The Today pill sits in the week row (week scale) or the year row (month
  // scale); labels it would cover give way to it.
  const clear = (n: number, text: string) => todayX == null || labelEnd(n, text) < todayX - 26 || x(n) > todayX + 26;
  const topLabels = scale === "week" ? tops : tops.filter((t) => clear(t.n, t.label));
  const tickLabels = ticks.filter((t) => t.label && (scale === "month" || clear(t.n, t.label)));

  // Open on today (about a third in), and again when the scale changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || todayX == null || !width) return;
    el.scrollLeft = Math.max(0, todayX - (el.clientWidth - labelW) * 0.33);
  }, [scale, width, todayX, labelW]);

  const present = new Set(dated.map(phaseState));

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-3 py-2">
        <p className="label">Timeline</p>
        <div role="group" aria-label="Timeline scale" className="inline-flex rounded-full bg-[var(--paper)] p-0.5">
          {([["week", "Weeks"], ["month", "Months"]] as [Scale, string][]).map(([key, label]) => (
            <button key={key} aria-pressed={scale === key} onClick={() => setScale(key)}
              className={`min-h-[32px] rounded-full px-3 text-[13px] font-bold ${scale === key ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--muted)]"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto" style={{ overscrollBehaviorX: "contain" }}>
        <div className="relative" style={{ width: labelW + innerW }}>
          {/* Grid lines and today line, behind the bars and under the frozen names. */}
          <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: labelW, width: innerW }}>
            {ticks.map((t, i) => (
              <span key={i} className="absolute inset-y-0 w-px" style={{ left: x(t.n), background: t.major ? "#D3CEC4" : "var(--line)" }} />
            ))}
            {todayX != null && <span className="absolute inset-y-0 z-[1] w-0.5 -translate-x-1/2 bg-[var(--accent)]" style={{ left: todayX }} />}
          </div>

          <div className="flex border-b border-[var(--line)]">
            <div className="sticky left-0 z-10 flex shrink-0 items-end border-r border-[var(--line)] bg-white px-3 pb-1.5" style={{ width: labelW, height: HEAD_H }}>
              <span className="label">Phase</span>
            </div>
            <div className="relative shrink-0" style={{ width: innerW, height: HEAD_H }}>
              {topLabels.map((t, i) => (
                <span key={i} className="absolute top-1.5 whitespace-nowrap pl-1.5 text-[12px] font-bold text-[var(--ink)]" style={{ left: x(t.n) }}>{t.label}</span>
              ))}
              {tickLabels.map((t, i) => (
                <span key={i} className="absolute bottom-1.5 whitespace-nowrap pl-1 text-[11px] font-semibold text-[var(--muted)]" style={{ left: x(t.n) }}>{t.label}</span>
              ))}
              {todayX != null && (
                <span className={`absolute z-[2] -translate-x-1/2 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold text-white ${scale === "week" ? "bottom-1" : "top-1"}`}
                  style={{ left: todayX }}>Today</span>
              )}
            </div>
          </div>

          {dated.map((p) => {
            const state = phaseState(p);
            const s = toDay(p.start_date!);
            const e = toDay(p.end_date ?? p.start_date!);
            const left = x(s);
            const span = Math.max((e - s + 1) * px, 8);
            const inspection = p.event_type === "inspection" && s === e;
            const now = state === "in_progress";
            const text = state === "on_hold" ? `On hold · ${dateText(p, year)}` : dateText(p, year);
            return (
              <div key={p.id} className="flex border-b border-[var(--line)] last:border-b-0">
                <div className={`sticky left-0 z-10 flex shrink-0 items-center border-r border-[var(--line)] px-3 ${now ? "bg-[#FBF1EB]" : "bg-white"}`}
                  style={{ width: labelW, height: ROW_H }}>
                  <span className={`line-clamp-2 text-[13px] font-semibold leading-tight sm:text-[14px] ${state === "done" ? "text-[var(--muted)]" : ""}`}>{p.name}</span>
                  <span className="sr-only">: {STATES[state].label}, {dateText(p, year)}</span>
                </div>
                <div className={`relative shrink-0 ${now ? "bg-[#FBF1EB]/60" : ""}`} style={{ width: innerW, height: ROW_H }} title={`${p.name} · ${STATES[state].label} · ${dateText(p, year)}`}>
                  {inspection ? (
                    <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px]"
                      style={{ left: left + px / 2, ...barStyle(state) }} />
                  ) : (
                    <span className="absolute top-1/2 h-[18px] -translate-y-1/2 rounded-md" style={{ left, width: span, ...barStyle(state) }} />
                  )}
                  {/* Sits over the today line so the dates stay readable where they cross it. */}
                  <span className={`absolute top-1/2 z-[2] -translate-y-1/2 whitespace-nowrap rounded px-1 text-[12px] ${now ? "bg-[#FBF1EB] font-bold text-[var(--ink)]" : "bg-white/90 font-semibold text-[var(--muted)]"}`}
                    style={{ left: (inspection ? left + px / 2 + 7 : left + span) + 3 }}>
                    {text}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {undated.length > 0 && (
        <p className="border-t border-[var(--line)] px-4 py-3 text-[14px] text-[var(--muted)]">
          <b className="text-[var(--ink)]">Dates to be set:</b> {undated.map((p) => p.name).join(", ")}
        </p>
      )}

      <ul className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--line)] px-4 py-3 text-[13px] text-[var(--muted)]">
        {LEGEND.filter((l) => present.has(l.key)).map((l) => (
          <li key={l.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-[4px]" style={barStyle(l.key)} />{l.label}
          </li>
        ))}
        {dated.some((p) => p.event_type === "inspection") && (
          <li className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 rounded-[2px] border-2 border-[var(--muted)]" />Inspection</li>
        )}
        {todayX != null && <li className="inline-flex items-center gap-1.5"><span className="h-3.5 w-0.5 bg-[var(--accent)]" />Today</li>}
      </ul>
    </section>
  );
}
