"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crewToday, scheduleDateLabel } from "@/lib/crew/schedule-dates";
import { v } from "./tokens";
import { JobDocsSheet } from "./job-docs-sheet";
import type { TodayPhase } from "@/lib/actions/daily-logs";
import { clockOutWithLog } from "@/lib/actions/daily-logs";
import { clockInOnPhase } from "@/lib/actions/daily-logs";
import { getCurrentPosition } from "@/lib/geo/current-position";
import { formatDistance } from "@/lib/crew/geo";

function fmtClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function dayWindow(start: string, end: string, selectedDate: string): string {
  if (start === end) return scheduleDateLabel(start, { month: "short", day: "numeric" });
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const today = new Date(selectedDate + "T00:00:00");
  today.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  const totalDays = Math.round((e.getTime() - s.getTime()) / dayMs) + 1;
  const dayNum = Math.min(totalDays, Math.max(1, Math.round((today.getTime() - s.getTime()) / dayMs) + 1));
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `Day ${dayNum} of ${totalDays} · ${fmt(s)} → ${fmt(e)}`;
}

function colorFromId(id: string): string {
  const palette = ["#D97706", "#0E7490", "#7C3AED", "#DC2626", "#059669", "#0891B2", "#B45309", "#0F766E"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function initials(first: string, last: string): string {
  return ((first?.[0] || "?") + (last?.[0] || "")).toUpperCase();
}

function MapsHref(phase: TodayPhase): string {
  const parts = [phase.project_address, phase.project_city, phase.project_state, phase.project_zip]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}`;
}

function PhaseBriefing({ phase, selectedDate, isToday }: { phase: TodayPhase; selectedDate: string; isToday: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [docsOpen, setDocsOpen] = useState(false);
  const isOpen = !!phase.open_log_id;

  const handleClockIn = () => {
    setError(null);
    startTransition(async () => {
      const loc = await getCurrentPosition();
      const res = await clockInOnPhase(phase.id, loc);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.onSite === false && res.distanceM != null) {
        setError(
          `Clocked in ${formatDistance(res.distanceM)} from the job site — this was flagged for your supervisor.`,
        );
      }
    });
  };

  const handleClockOut = () => {
    setError(null);
    startTransition(async () => {
      const result = await clockOutWithLog(phase.open_log_id!);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const fullAddress = [phase.project_address, phase.project_city, phase.project_state]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: v("card"), border: `1px solid ${isOpen ? "rgba(16, 185, 129, 0.5)" : v("line")}`, boxShadow: "0 2px 4px rgba(0,0,0,0.3)" }}
    >
      {/* Header — project + customer */}
      <div className="px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${v("line-soft")}` }}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em]" style={{ color: v("quiet") }}>
            {phase.project_number}
          </div>
          {isOpen && phase.open_log_started_at && (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase"
              style={{ background: "rgba(52, 211, 153, 0.14)", color: "#34d399", letterSpacing: "0.12em" }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
              Clocked in · {fmtClockTime(phase.open_log_started_at)}
            </span>
          )}
        </div>
        <div className="text-[20px] font-semibold leading-tight mt-0.5" style={{ color: v("ink"), textWrap: "balance" }}>
          {phase.project_name}
        </div>
        {phase.customer_name && (
          <div className="text-[13px] mt-0.5" style={{ color: v("muted") }}>
            for {phase.customer_name}
            {phase.project_type && phase.project_type !== "other" && (
              <span className="ml-2 opacity-70">· {phase.project_type.replace(/_/g, " ")}</span>
            )}
          </div>
        )}
      </div>

      {/* Today's task */}
      <div className="px-5 py-3 flex flex-col gap-2.5">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] mb-1" style={{ color: v("quiet") }}>
            {isToday ? "Today’s task" : "Scheduled task"}
          </div>
          <div className="text-[16px] font-semibold leading-snug" style={{ color: v("ink") }}>
            {phase.name}
          </div>
          {phase.line_item_description && (
            <div className="text-[13px] leading-snug mt-1" style={{ color: v("muted") }}>
              {phase.line_item_description}
              {phase.line_item_quantity != null && phase.line_item_unit && (
                <span className="ml-2 opacity-70">· {phase.line_item_quantity} {phase.line_item_unit}</span>
              )}
            </div>
          )}
          {phase.line_item_scope && (
            <p className="text-[12px] leading-snug mt-1.5 whitespace-pre-wrap" style={{ color: v("muted") }}>
              {phase.line_item_scope}
            </p>
          )}
          {phase.description && phase.description !== phase.line_item_description && (
            <p className="text-[12px] leading-snug mt-1.5" style={{ color: v("muted") }}>
              {phase.description}
            </p>
          )}
        </div>

        {/* Notes / special instructions */}
        {phase.notes && (
          <div
            className="rounded-lg px-3 py-2 text-[12px] leading-snug"
            style={{ background: "rgba(217, 119, 6, 0.08)", border: "1px solid rgba(217, 119, 6, 0.20)", color: "#fbbf24" }}
          >
            <span className="font-semibold uppercase tracking-wider text-[10px] mr-2" style={{ letterSpacing: "0.16em" }}>
              Note
            </span>
            {phase.notes}
          </div>
        )}

        {/* Address + schedule + crew row */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {fullAddress && (
            <a
              href={MapsHref(phase)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg hover:opacity-80 transition"
              style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4 mt-0.5 flex-shrink-0">
                <path d="M10 3c3 0 5 2 5 5 0 4-5 9-5 9s-5-5-5-9c0-3 2-5 5-5z" />
                <circle cx="10" cy="8" r="2" />
              </svg>
              <div className="min-w-0 flex-1 text-[12px] leading-tight">
                <div className="font-medium truncate">{phase.project_address}</div>
                <div className="opacity-70 truncate">
                  {[phase.project_city, phase.project_state].filter(Boolean).join(", ")}
                </div>
              </div>
            </a>
          )}
          <div
            className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg"
            style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4 mt-0.5 flex-shrink-0">
              <rect x="3" y="5" width="14" height="12" rx="1.5" />
              <path d="M3 9h14M7 3v3M13 3v3" />
            </svg>
            <div className="min-w-0 flex-1 text-[12px] leading-tight">
              <div className="font-medium">{phase.start_date === phase.end_date ? "Single day" : "Multi-day"}</div>
              <div className="opacity-70">{dayWindow(phase.start_date, phase.end_date, selectedDate)}</div>
            </div>
          </div>
        </div>

        {/* Crew chips */}
        {phase.crew.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap pt-0.5">
            <span className="text-[10px] uppercase tracking-[0.16em]" style={{ color: v("quiet") }}>Crew</span>
            {phase.crew.map((c) => (
              <span
                key={c.id}
                title={`${c.first_name} ${c.last_name}${c.title ? ` · ${c.title}` : ""}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
                style={{ background: `${colorFromId(c.id)}22`, border: `1px solid ${colorFromId(c.id)}55`, color: colorFromId(c.id) }}
              >
                <span
                  className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                  style={{ background: colorFromId(c.id) }}
                >
                  {initials(c.first_name, c.last_name)}
                </span>
                {c.first_name}
              </span>
            ))}
          </div>
        )}

        {/* Latest update from this phase */}
        {phase.latest_log?.text && (
          <div className="pt-1">
            <div className="text-[10px] uppercase tracking-[0.16em] mb-1" style={{ color: v("quiet") }}>
              Last update
            </div>
            <div className="text-[12px] leading-snug" style={{ color: v("muted") }}>
              <span className="font-medium" style={{ color: v("ink") }}>
                {phase.latest_log.author_name ?? "Someone"}
              </span>
              <span className="opacity-70"> · {fmtRelative(phase.latest_log.started_at)}</span>
              <div className="mt-0.5 line-clamp-2">{phase.latest_log.text}</div>
            </div>
          </div>
        )}

        {error && (
          <div
            className="text-[12px] px-2.5 py-1.5 rounded-lg"
            style={{ background: "rgba(239, 68, 68, 0.14)", color: "#fca5a5", border: "1px solid rgba(239, 68, 68, 0.3)" }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="px-4 py-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${v("line-soft")}` }}>
        {isToday && (isOpen ? (
          <button
            onClick={handleClockOut}
            disabled={pending}
            className="w-full py-3.5 rounded-xl flex items-center justify-center gap-2 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: v("accent"), color: "#1a0f00" }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 6v4l2.5 2" />
            </svg>
            {pending ? "Clocking out…" : "Clock out"}
          </button>
        ) : (
          <button
            onClick={handleClockIn}
            disabled={pending}
            className="w-full py-3.5 rounded-xl flex items-center justify-center gap-2 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: v("accent"), color: "#1a0f00" }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 6v4l2.5 2" />
            </svg>
            {pending ? "Clocking in…" : "Clock in"}
          </button>
        ))}
        <div className="flex gap-2">
          <button
            onClick={() => setDocsOpen(true)}
            className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-medium transition active:scale-[0.98]"
            style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4">
              <path d="M5 3h7l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
              <path d="M12 3v4h4" />
            </svg>
            Plans
          </button>
          {fullAddress && (
            <a
              href={MapsHref(phase)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-medium transition active:scale-[0.98]"
              style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4">
                <path d="M10 3c3 0 5 2 5 5 0 4-5 9-5 9s-5-5-5-9c0-3 2-5 5-5z" />
                <circle cx="10" cy="8" r="2" />
              </svg>
              Directions
            </a>
          )}
          {phase.customer_phone && (
            <a
              href={`tel:${phase.customer_phone}`}
              className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-medium transition active:scale-[0.98]"
              style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-4 h-4">
                <path d="M4 5c0 6 5 11 11 11l1-3-3.5-1.5L11 13c-1.5-.7-2.8-2-3.5-3.5L9 8 7.5 4.5 4.5 5z" />
              </svg>
              Call
            </a>
          )}
        </div>
      </div>
      {docsOpen && (
        <JobDocsSheet
          projectId={phase.project_id}
          jobName={phase.project_name}
          onClose={() => setDocsOpen(false)}
        />
      )}
    </div>
  );
}

export function TodaysWorkCard({ phases, selectedDate = crewToday(), isToday = true }: { phases: TodayPhase[]; selectedDate?: string; isToday?: boolean }) {
  if (phases.length === 0) {
    return (
      <div className="rounded-2xl p-5" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
        <div className="text-[11px] font-medium uppercase mb-2" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
          {isToday ? "Today’s work" : "Scheduled work"}
        </div>
        <div className="text-[14px]" style={{ color: v("muted") }}>
          {isToday ? "Nothing scheduled for you today." : "No confirmed work scheduled for this day yet."}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between px-1">
        <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
          {isToday ? "Today’s work" : "Scheduled work"}
        </div>
        <div className="text-[12px]" style={{ color: v("muted") }}>
          {phases.length} {phases.length === 1 ? "assignment" : "assignments"}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {phases.map((p) => (
          <PhaseBriefing key={p.id} phase={p} selectedDate={selectedDate} isToday={isToday} />
        ))}
      </div>
    </>
  );
}
