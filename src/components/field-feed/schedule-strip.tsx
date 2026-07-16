"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { v } from "./tokens";
import type { WeekSchedulePhase } from "@/lib/actions/daily-logs";
import { getScheduleProjectOptions } from "@/lib/actions/schedule";
import { MapView, type MapPin } from "./map-view";
import { ProjectDaySheet } from "@/components/schedule/project-day-sheet";
import { ScheduleQuickAddSheet } from "@/components/schedule/schedule-quick-add-sheet";
import type { ScheduleProjectOption } from "@/components/schedule/project-picker";

type ViewMode = "week" | "day" | "list" | "map";

function colorFromId(id: string): string {
  const palette = ["#D97706", "#0E7490", "#7C3AED", "#DC2626", "#059669", "#0891B2", "#B45309", "#0F766E"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function initials(first: string, last: string): string {
  return ((first?.[0] || "?") + (last?.[0] || "")).toUpperCase();
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildScheduleDays(weekStartIso: string, weekEndIso: string): Date[] {
  const start = new Date(weekStartIso + "T00:00:00");
  const end = new Date(weekEndIso + "T00:00:00");
  const dayMs = 24 * 60 * 60 * 1000;
  const span = Math.max(0, Math.round((end.getTime() - start.getTime()) / dayMs)) + 1;
  return Array.from({ length: span }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function phasesOnDate(phases: WeekSchedulePhase[], date: Date): WeekSchedulePhase[] {
  const k = dateKey(date);
  return phases.filter((p) => p.start_date <= k && p.end_date >= k);
}

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------------------------------------------------------------------------
// Phase card (used in Day, List, Map info window)
// ---------------------------------------------------------------------------

function CrewChips({ crew }: { crew: WeekSchedulePhase["crew"] }) {
  if (crew.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {crew.map((c) => (
        <span
          key={c.id}
          title={`${c.first_name} ${c.last_name}`}
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
  );
}

type ProjectGroup = {
  project_id: string;
  project_number: string;
  project_name: string;
  project_address: string | null;
  project_city: string | null;
  color: string;
  phases: WeekSchedulePhase[];
};

function groupByProject(phases: WeekSchedulePhase[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();
  for (const p of phases) {
    const existing = map.get(p.project_id);
    if (existing) {
      existing.phases.push(p);
    } else {
      map.set(p.project_id, {
        project_id: p.project_id,
        project_number: p.project_number,
        project_name: p.project_name,
        project_address: p.project_address,
        project_city: p.project_city,
        color: p.color,
        phases: [p],
      });
    }
  }
  return Array.from(map.values());
}

function ProjectGroupCard({ group, showDateRange, defaultDate }: { group: ProjectGroup; showDateRange: boolean; defaultDate?: string }) {
  const multi = group.phases.length > 1;
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="w-full text-left rounded-xl p-3 flex flex-col gap-2.5 transition active:scale-[0.99]"
        style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, borderLeft: `3px solid ${group.color}` }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[10px] font-mono uppercase" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>
            {group.project_number}
          </div>
          {multi && (
            <div className="text-[10px] uppercase" style={{ color: v("quiet"), letterSpacing: "0.14em" }}>
              {group.phases.length} phases
            </div>
          )}
        </div>
        <div>
          <div className="text-[14px] font-semibold leading-tight" style={{ color: v("ink") }}>{group.project_name}</div>
          {(group.project_address || group.project_city) && (
            <div className="text-[11px] mt-0.5" style={{ color: v("muted") }}>
              {[group.project_address, group.project_city].filter(Boolean).join(", ")}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {group.phases.map((p) => (
            <div
              key={p.id}
              className="rounded-lg px-2.5 py-2 flex flex-col gap-1.5"
              style={{ background: v("card"), border: `1px solid ${v("line-soft")}` }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[12px] font-medium" style={{ color: v("ink") }}>
                  {p.name}
                  {p.line_item_description && (
                    <span className="opacity-70 font-normal"> · {p.line_item_description}</span>
                  )}
                  {p.is_confirmed && (
                    <span
                      title={p.confirmed_with ? `Confirmed · ${p.confirmed_with}` : "Confirmed with sub"}
                      className="ml-1.5 inline-flex items-center align-middle rounded px-1 py-0.5"
                      style={{ background: "rgba(16,185,129,0.16)", color: "#34d399", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em" }}
                    >
                      LOCKED
                    </span>
                  )}
                </div>
                {showDateRange && p.start_date !== p.end_date && (
                  <div className="text-[10px] uppercase whitespace-nowrap" style={{ color: v("quiet"), letterSpacing: "0.14em" }}>
                    {new Date(p.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {" → "}
                    {new Date(p.end_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                )}
              </div>
              <CrewChips crew={p.crew} />
            </div>
          ))}
        </div>
      </button>
      <ProjectDaySheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        projectId={group.project_id}
        projectName={group.project_name}
        projectNumber={group.project_number}
        phases={group.phases}
        defaultDate={defaultDate}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Map view
// ---------------------------------------------------------------------------


function buildPins(phases: WeekSchedulePhase[]): MapPin[] {
  const byProject = new Map<string, MapPin>();
  for (const p of phases) {
    if (p.project_lat == null || p.project_lng == null) continue;
    // Supabase returns numeric columns as strings — coerce to number.
    const lat = typeof p.project_lat === "number" ? p.project_lat : Number(p.project_lat);
    const lng = typeof p.project_lng === "number" ? p.project_lng : Number(p.project_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!byProject.has(p.project_id)) {
      byProject.set(p.project_id, {
        project_id: p.project_id,
        project_name: p.project_name,
        project_number: p.project_number,
        lat,
        lng,
        address:
          [p.project_address, p.project_city].filter(Boolean).join(", ") || null,
      });
    }
  }
  return Array.from(byProject.values());
}


// ---------------------------------------------------------------------------
// Strip
// ---------------------------------------------------------------------------

export function ScheduleStrip({
  weekStart,
  weekEnd,
  phases,
  myEmployeeIds,
  defaultCollapsed = false,
  compact = false,
}: {
  weekStart: string;
  weekEnd: string;
  phases: WeekSchedulePhase[];
  myEmployeeIds: string[];
  defaultCollapsed?: boolean;
  compact?: boolean;
}) {
  const days = useMemo(() => buildScheduleDays(weekStart, weekEnd), [weekStart, weekEnd]);
  const todayKey = dateKey(new Date());
  const [view, setView] = useState<ViewMode>("day");
  const [mineOnly, setMineOnly] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [selectedDayKey, setSelectedDayKey] = useState<string>(
    days.find((d) => dateKey(d) === todayKey) ? todayKey : dateKey(days[0]),
  );

  // "+ Add" → the same quick-add sheet as the full schedule page. The project
  // list (any active project, not just already-scheduled ones) is lazy-loaded
  // the first time the button is tapped.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ScheduleProjectOption[] | null>(null);

  const openQuickAdd = async () => {
    setQuickAddLoading(true);
    try {
      if (!projectOptions) {
        setProjectOptions(await getScheduleProjectOptions());
      }
      setQuickAddOpen(true);
    } finally {
      setQuickAddLoading(false);
    }
  };

  const dayStripRef = useRef<HTMLDivElement>(null);

  const myEmpSet = useMemo(() => new Set(myEmployeeIds), [myEmployeeIds]);

  // When the day view opens, scroll the day picker so today is centered —
  // otherwise an 8-week strip starts at week 1 and the user has to scroll
  // forward to find today every time.
  useEffect(() => {
    if (view !== "day") return;
    const el = dayStripRef.current?.querySelector<HTMLElement>("[data-today]");
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [view]);

  const filteredPhases = useMemo(() => {
    if (!mineOnly || myEmpSet.size === 0) return phases;
    // We don't have assigned_employee_ids on the WeekSchedulePhase shape, but
    // we do have crew (joined employees). Filter on whether crew contains me.
    return phases.filter((p) => p.crew.some((c) => myEmpSet.has(c.id)));
  }, [phases, mineOnly, myEmpSet]);

  const selectedDate = useMemo(() => {
    const found = days.find((d) => dateKey(d) === selectedDayKey);
    return found ?? days[0];
  }, [days, selectedDayKey]);

  const dayPhases = useMemo(() => phasesOnDate(filteredPhases, selectedDate), [filteredPhases, selectedDate]);
  const todayDate = useMemo(
    () => days.find((day) => dateKey(day) === todayKey) ?? new Date(),
    [days, todayKey],
  );
  const todayPhases = useMemo(
    () => phasesOnDate(filteredPhases, todayDate),
    [filteredPhases, todayDate],
  );

  // Stable pins for the map view — MapView re-inits the Google map when the
  // pins array identity changes, so memoize off the memoized phases.
  const mapPins = useMemo(() => buildPins(filteredPhases), [filteredPhases]);
  const mapMissingCount = useMemo(
    () =>
      new Set(
        filteredPhases
          .filter((p) => p.project_lat == null || p.project_lng == null)
          .map((p) => p.project_id),
      ).size,
    [filteredPhases],
  );

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      {/* Header */}
      <div
        className={`${compact && collapsed ? "px-3 py-2.5" : "px-4 pt-3.5 pb-3"} flex flex-col gap-3`}
        style={{ borderBottom: collapsed ? "none" : `1px solid ${v("line-soft")}` }}
      >
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex-1 flex items-center gap-2 text-left active:opacity-70"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand schedule" : "Collapse schedule"}
          >
            {compact && collapsed ? (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(217,119,6,0.12)", color: v("accent") }}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-[18px] w-[18px]" aria-hidden="true">
                  <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
                  <path d="M6.5 2.8v3.4M13.5 2.8v3.4M3 8h14" />
                </svg>
              </span>
            ) : (
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 transition-transform"
                style={{ color: v("muted"), transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
              >
                <path d="M5 8l5 5 5-5" />
              </svg>
            )}
            <div>
              <div className="text-[10px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
                Schedule
              </div>
              <div className="text-[16px] font-semibold leading-tight mt-0.5" style={{ color: v("ink") }}>
                {compact && collapsed ? (
                  "Today"
                ) : (
                  <>
                    {days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} —{" "}
                    {days[days.length - 1].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </>
                )}
              </div>
            </div>
          </button>
          {myEmpSet.size > 0 && !collapsed && (
            <button
              onClick={() => setMineOnly((x) => !x)}
              className="px-3 py-1 rounded-md text-[12px] font-semibold transition"
              style={{
                background: mineOnly ? v("accent") : v("bg-2"),
                color: mineOnly ? "#1a0f00" : v("muted"),
                border: `1px solid ${mineOnly ? "transparent" : v("line")}`,
              }}
            >
              {mineOnly ? "Mine only" : "All"}
            </button>
          )}
          <Link
            href="/schedule"
            aria-label="Open full schedule"
            title="Open full schedule"
            className={`${compact && collapsed ? "flex items-center gap-2" : "flex h-9 w-9 items-center justify-center rounded-lg"} shrink-0 transition active:scale-95`}
            style={compact && collapsed
              ? undefined
              : { background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("accent") }}
          >
            {compact && collapsed && (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: v("bg-2"), color: todayPhases.length > 0 ? v("accent") : v("quiet") }}>
                {todayPhases.length === 0
                  ? "Clear"
                  : `${todayPhases.length} job${todayPhases.length === 1 ? "" : "s"}`}
              </span>
            )}
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 -rotate-90" style={{ color: compact && collapsed ? v("quiet") : undefined }} aria-hidden="true">
              <path d="M5 8l5 5 5-5" />
            </svg>
          </Link>
        </div>
        {!collapsed && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}>
              {(["day", "week", "list", "map"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setView(mode)}
                  className="px-3 py-1 rounded-md text-[12px] font-semibold transition"
                  style={{
                    background: view === mode ? v("accent") : "transparent",
                    color: view === mode ? "#1a0f00" : v("muted"),
                  }}
                >
                  {mode === "week" ? "Week" : mode === "day" ? "Day" : mode === "list" ? "List" : "Map"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={openQuickAdd}
              disabled={quickAddLoading}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition active:scale-95 disabled:opacity-60"
              style={{ background: v("accent"), color: "#1a0f00" }}
            >
              {quickAddLoading ? "Loading…" : "+ Add"}
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          {/* Week */}
          {view === "week" && (
        <div className="p-3">
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const k = dateKey(d);
              const isToday = k === todayKey;
              const items = phasesOnDate(filteredPhases, d);
              return (
                <button
                  key={k}
                  onClick={() => { setSelectedDayKey(k); setView("day"); }}
                  className="rounded-lg p-2 flex flex-col gap-1.5 text-left transition active:scale-[0.98]"
                  style={{
                    background: isToday ? "rgba(217, 119, 6, 0.10)" : v("bg-2"),
                    border: `1px solid ${isToday ? "rgba(217, 119, 6, 0.45)" : v("line")}`,
                    minHeight: 96,
                  }}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-medium uppercase" style={{ color: isToday ? v("accent") : v("quiet"), letterSpacing: "0.14em" }}>
                      {DOW_SHORT[(d.getDay() + 6) % 7]}
                    </span>
                    <span className="text-[14px] font-semibold tabular-nums" style={{ color: isToday ? v("accent") : v("ink") }}>
                      {d.getDate()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 min-h-0 flex-1">
                    {items.slice(0, 3).map((p) => (
                      <div key={p.id} className="rounded text-[10px] leading-tight px-1.5 py-1 truncate" style={{ background: `${p.color}22`, borderLeft: `2px solid ${p.color}`, color: v("ink") }}>
                        <div className="font-semibold truncate">{p.project_name}</div>
                        <div className="opacity-70 truncate">{p.name}</div>
                      </div>
                    ))}
                    {items.length > 3 && <div className="text-[10px]" style={{ color: v("quiet") }}>+{items.length - 3} more</div>}
                    {items.length === 0 && <div className="text-[10px] italic" style={{ color: v("quiet") }}>—</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Day */}
      {view === "day" && (
        <div className="p-3 flex flex-col gap-3">
          <div ref={dayStripRef} className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {days.map((d) => {
              const k = dateKey(d);
              const isSelected = k === selectedDayKey;
              const isToday = k === todayKey;
              const count = phasesOnDate(filteredPhases, d).length;
              return (
                <button
                  key={k}
                  onClick={() => setSelectedDayKey(k)}
                  data-today={isToday ? "" : undefined}
                  className="flex flex-col items-center px-3 py-1.5 rounded-lg flex-shrink-0 transition"
                  style={{
                    background: isSelected ? v("accent") : v("bg-2"),
                    border: `1px solid ${isSelected ? "transparent" : isToday ? "rgba(217, 119, 6, 0.35)" : v("line")}`,
                    color: isSelected ? "#1a0f00" : isToday ? v("accent") : v("ink"),
                    minWidth: 56,
                  }}
                >
                  <span className="text-[10px] font-medium uppercase" style={{ letterSpacing: "0.14em" }}>{DOW_SHORT[(d.getDay() + 6) % 7]}</span>
                  <span className="text-[16px] font-semibold tabular-nums leading-none mt-0.5">{d.getDate()}</span>
                  {count > 0 && <span className="text-[9px] mt-1 opacity-70">{count} {count === 1 ? "job" : "jobs"}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2">
            {dayPhases.length === 0 ? (
              <div className="rounded-lg px-4 py-8 text-center" style={{ background: v("bg-2"), border: `1px dashed ${v("line")}`, color: v("muted") }}>
                <div className="text-[13px]">{mineOnly ? "Nothing assigned to you" : "Nothing scheduled"}</div>
                <div className="text-[11px] opacity-70 mt-1">{selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
              </div>
            ) : (
              groupByProject(dayPhases).map((g) => (
                <ProjectGroupCard key={g.project_id} group={g} showDateRange={false} defaultDate={selectedDayKey} />
              ))
            )}
          </div>
        </div>
      )}

      {/* List */}
      {view === "list" && (
        <div className="p-3 flex flex-col gap-2">
          {filteredPhases.length === 0 ? (
            <div className="rounded-lg px-4 py-8 text-center" style={{ background: v("bg-2"), border: `1px dashed ${v("line")}`, color: v("muted") }}>
              <div className="text-[13px]">Nothing scheduled this week{mineOnly ? " for you" : ""}</div>
            </div>
          ) : (
            groupByProject(filteredPhases).map((g) => (
              <ProjectGroupCard key={g.project_id} group={g} showDateRange={true} />
            ))
          )}
        </div>
      )}

      {/* Map */}
      {view === "map" && (
        <div className="p-3">
          <MapView pins={mapPins} missingProjectCount={mapMissingCount} />
        </div>
      )}
        </>
      )}

      {quickAddOpen && projectOptions && (
        <ScheduleQuickAddSheet
          open
          onOpenChange={setQuickAddOpen}
          projects={projectOptions}
          defaultDate={selectedDayKey}
          onCreated={(_projectId, date) => {
            setSelectedDayKey(date);
            setView("day");
          }}
        />
      )}
    </div>
  );
}
