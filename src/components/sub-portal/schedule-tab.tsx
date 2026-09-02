"use client";

import { CalendarDays } from "lucide-react";
import type { Phase, Project } from "./types";
import { Card, DirectionsLink, EmptyState, MONO, SectionLabel, fmtDate } from "./ui";

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Schedule: every phase the sub is assigned to, bucketed the way a sub
 * thinks about a week — this week, next week, later — with past work folded.
 */
export function ScheduleTab({
  upcoming,
  past,
  projectById,
}: {
  upcoming: Phase[];
  past: Phase[];
  projectById: Map<string, Project>;
}) {
  const now = new Date();
  const nextWeekStart = iso(new Date(startOfWeek(now).getTime() + 7 * 86_400_000));
  const weekAfterStart = iso(new Date(startOfWeek(now).getTime() + 14 * 86_400_000));

  const bucket = (p: Phase) => {
    const s = p.start_date ?? "";
    if (!s) return "later";
    if (s < nextWeekStart) return "this";
    if (s < weekAfterStart) return "next";
    return "later";
  };
  const groups: [string, Phase[]][] = [
    ["This week", upcoming.filter((p) => bucket(p) === "this")],
    ["Next week", upcoming.filter((p) => bucket(p) === "next")],
    ["Later", upcoming.filter((p) => bucket(p) === "later")],
  ];

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing on the schedule"
        body="We'll add you here when your next phase is booked. Check the Jobs tab for what's awarded."
      />
    );
  }

  return (
    <div className="space-y-7">
      {upcoming.length === 0 && (
        <p className="py-6 text-center text-[13px] text-stone-500">
          Nothing coming up. We&apos;ll add you when your next phase is booked.
        </p>
      )}
      {groups.map(([label, phases]) =>
        phases.length === 0 ? null : (
          <section key={label}>
            <SectionLabel right={<span className="text-[11px] text-stone-600" style={MONO}>{phases.length}</span>}>
              {label}
            </SectionLabel>
            <div className="space-y-2.5">
              {phases.map((p) => {
                const proj = projectById.get(p.project_id);
                const today = iso(now);
                const active = !!p.start_date && p.start_date <= today && (!p.end_date || p.end_date >= today);
                return (
                  <Card key={p.id} tone={active ? "amber" : "default"} className="p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[15px] font-semibold text-stone-100">{p.name}</p>
                      <p className="shrink-0 text-[12px] text-amber-400" style={MONO}>
                        {fmtDate(p.start_date)}
                        {p.end_date && p.end_date !== p.start_date ? ` – ${fmtDate(p.end_date)}` : ""}
                      </p>
                    </div>
                    {proj && (
                      <p className="mt-1 text-[12px] text-stone-500" style={MONO}>
                        {proj.name}
                        {proj.address ? ` · ${proj.address}` : ""}
                      </p>
                    )}
                    {p.description && (
                      <p className="mt-2 text-[13px] leading-relaxed text-stone-400">{p.description}</p>
                    )}
                    {proj?.address && (
                      <div className="mt-2.5">
                        <DirectionsLink address={proj.address} />
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>
        ),
      )}

      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] uppercase tracking-[0.24em] text-stone-500" style={MONO}>
            Past work ({past.length})
          </summary>
          <div className="mt-3 space-y-2">
            {[...past].reverse().map((p) => {
              const proj = projectById.get(p.project_id);
              return (
                <div key={p.id} className="rounded-xl border border-white/[0.05] px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13px] text-stone-400">{p.name}</p>
                    <p className="shrink-0 text-[11px] text-stone-600" style={MONO}>{fmtDate(p.start_date)}</p>
                  </div>
                  {proj && <p className="text-[11px] text-stone-600" style={MONO}>{proj.name}</p>}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
