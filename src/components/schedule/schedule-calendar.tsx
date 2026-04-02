"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  CalendarDays,
  Clock,
  MapPin,
} from "lucide-react";
import type { SchedulePhase, Project } from "@/types/database";

interface ScheduleCalendarProps {
  phases: (SchedulePhase & { project?: Project })[];
}

type ViewMode = "month" | "week" | "day";

// ── Helpers ──────────────────────────────────────

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function dateToStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getWeekStart(d: Date) {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay()); // Sunday
  r.setHours(0, 0, 0, 0);
  return r;
}

function formatShortDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFullDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDayName(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function formatMonthYear(year: number, month: number) {
  return new Date(year, month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  on_hold: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  on_hold: "On Hold",
};

// ── Main Component ──────────────────────────────────────

export function ScheduleCalendar({ phases }: ScheduleCalendarProps) {
  const today = new Date();
  const todayStr = dateToStr(today);

  const [view, setView] = useState<ViewMode>("week");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(new Date(today));
  const [weekStart, setWeekStart] = useState(getWeekStart(today));

  // Navigation
  function prevPeriod() {
    if (view === "month") {
      if (month === 0) { setMonth(11); setYear((y) => y - 1); }
      else setMonth((m) => m - 1);
    } else if (view === "week") {
      setWeekStart((w) => addDays(w, -7));
    } else {
      setSelectedDate((d) => addDays(d, -1));
    }
  }

  function nextPeriod() {
    if (view === "month") {
      if (month === 11) { setMonth(0); setYear((y) => y + 1); }
      else setMonth((m) => m + 1);
    } else if (view === "week") {
      setWeekStart((w) => addDays(w, 7));
    } else {
      setSelectedDate((d) => addDays(d, 1));
    }
  }

  function goToToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDate(new Date(today));
    setWeekStart(getWeekStart(today));
  }

  // Period label
  const periodLabel = useMemo(() => {
    if (view === "month") return formatMonthYear(year, month);
    if (view === "week") {
      const end = addDays(weekStart, 6);
      return `${formatShortDate(weekStart)} – ${formatShortDate(end)}`;
    }
    return formatFullDate(selectedDate);
  }, [view, year, month, weekStart, selectedDate]);

  // Click a day in month/week view to drill into day view
  function selectDay(date: Date) {
    setSelectedDate(date);
    setView("day");
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        {/* View mode tabs */}
        <div className="flex items-center justify-center gap-1 mb-3">
          <Button
            variant={view === "month" ? "default" : "ghost"}
            size="sm"
            onClick={() => setView("month")}
            className="gap-1.5"
          >
            <Calendar className="h-3.5 w-3.5" />
            Month
          </Button>
          <Button
            variant={view === "week" ? "default" : "ghost"}
            size="sm"
            onClick={() => setView("week")}
            className="gap-1.5"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Week
          </Button>
          <Button
            variant={view === "day" ? "default" : "ghost"}
            size="sm"
            onClick={() => setView("day")}
            className="gap-1.5"
          >
            <Clock className="h-3.5 w-3.5" />
            Day
          </Button>
        </div>

        {/* Period navigation */}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="icon" onClick={prevPeriod}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <h2 className="text-lg font-semibold">{periodLabel}</h2>
            <Button
              variant="link"
              size="sm"
              onClick={goToToday}
              className="text-xs text-muted-foreground h-auto p-0"
            >
              Today
            </Button>
          </div>
          <Button variant="outline" size="icon" onClick={nextPeriod}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {view === "month" && (
          <MonthView
            phases={phases}
            year={year}
            month={month}
            todayStr={todayStr}
            onSelectDay={selectDay}
          />
        )}
        {view === "week" && (
          <WeekView
            phases={phases}
            weekStart={weekStart}
            todayStr={todayStr}
            onSelectDay={selectDay}
          />
        )}
        {view === "day" && (
          <DayView phases={phases} date={selectedDate} todayStr={todayStr} />
        )}

        {/* Legend */}
        <PhaseLegend phases={phases} />
      </CardContent>
    </Card>
  );
}

// ── Month View ──────────────────────────────────────

function MonthView({
  phases,
  year,
  month,
  todayStr,
  onSelectDay,
}: {
  phases: (SchedulePhase & { project?: Project })[];
  year: number;
  month: number;
  todayStr: string;
  onSelectDay: (d: Date) => void;
}) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const dayPhases = useMemo(() => {
    const result: Map<number, (SchedulePhase & { project?: Project })[]> = new Map();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const active = phases.filter(
        (p) => p.start_date <= dateStr && p.end_date >= dateStr
      );
      result.set(d, active);
    }
    return result;
  }, [year, month, daysInMonth, phases]);

  return (
    <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
      {dayNames.map((d) => (
        <div
          key={d}
          className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground"
        >
          {d}
        </div>
      ))}

      {Array.from({ length: firstDay }, (_, i) => (
        <div key={`empty-${i}`} className="bg-background p-1 min-h-[80px]" />
      ))}

      {Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const isToday = dateStr === todayStr;
        const active = dayPhases.get(day) ?? [];

        return (
          <div
            key={day}
            className={`bg-background p-1 min-h-[80px] cursor-pointer hover:bg-muted/50 transition-colors ${
              isToday ? "ring-2 ring-primary ring-inset" : ""
            }`}
            onClick={() => onSelectDay(new Date(year, month, day))}
          >
            <div
              className={`text-xs font-medium mb-1 ${
                isToday
                  ? "bg-primary text-primary-foreground w-5 h-5 rounded-full flex items-center justify-center"
                  : "text-muted-foreground"
              }`}
            >
              {day}
            </div>
            <div className="space-y-0.5">
              {active.slice(0, 3).map((phase) => (
                <div
                  key={phase.id}
                  className="text-[10px] leading-tight px-1 py-0.5 rounded truncate text-white"
                  style={{ backgroundColor: phase.color }}
                  title={`${phase.name}${phase.project ? ` — ${phase.project.name}` : ""}`}
                >
                  {phase.name}
                </div>
              ))}
              {active.length > 3 && (
                <div className="text-[10px] text-muted-foreground px-1">
                  +{active.length - 3} more
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Week View ──────────────────────────────────────

function WeekView({
  phases,
  weekStart,
  todayStr,
  onSelectDay,
}: {
  phases: (SchedulePhase & { project?: Project })[];
  weekStart: Date;
  todayStr: string;
  onSelectDay: (d: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Get phases active on each day
  const dayData = useMemo(() => {
    return days.map((d) => {
      const ds = dateToStr(d);
      const active = phases.filter(
        (p) => p.start_date <= ds && p.end_date >= ds
      );
      return { date: d, dateStr: ds, phases: active };
    });
  }, [days, phases]);

  return (
    <div className="space-y-0">
      {/* Desktop: horizontal columns */}
      <div className="hidden md:grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
        {dayData.map(({ date, dateStr, phases: dayPhases }) => {
          const isToday = dateStr === todayStr;
          return (
            <div
              key={dateStr}
              className={`bg-background p-2 min-h-[200px] cursor-pointer hover:bg-muted/50 transition-colors ${
                isToday ? "ring-2 ring-primary ring-inset" : ""
              }`}
              onClick={() => onSelectDay(date)}
            >
              <div className="text-center mb-2">
                <div className="text-xs text-muted-foreground">
                  {formatDayName(date)}
                </div>
                <div
                  className={`text-lg font-semibold ${
                    isToday
                      ? "bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center mx-auto"
                      : ""
                  }`}
                >
                  {date.getDate()}
                </div>
              </div>
              <div className="space-y-1">
                {dayPhases.map((phase) => (
                  <div
                    key={phase.id}
                    className="text-[11px] leading-tight px-1.5 py-1 rounded text-white truncate"
                    style={{ backgroundColor: phase.color }}
                    title={`${phase.name}${phase.project ? ` — ${phase.project.name}` : ""}`}
                  >
                    {phase.name}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile: stacked day rows */}
      <div className="md:hidden space-y-2">
        {dayData.map(({ date, dateStr, phases: dayPhases }) => {
          const isToday = dateStr === todayStr;
          return (
            <div
              key={dateStr}
              className={`rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                isToday
                  ? "border-primary bg-primary/5"
                  : "border-border/50"
              }`}
              onClick={() => onSelectDay(date)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      isToday ? "text-primary" : ""
                    }`}
                  >
                    {formatDayName(date)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatShortDate(date)}
                  </span>
                  {isToday && (
                    <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                      Today
                    </span>
                  )}
                </div>
                {dayPhases.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {dayPhases.length} phase{dayPhases.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {dayPhases.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 italic">
                  No phases scheduled
                </p>
              ) : (
                <div className="space-y-1">
                  {dayPhases.map((phase) => (
                    <div
                      key={phase.id}
                      className="flex items-center gap-2"
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: phase.color }}
                      />
                      <span className="text-sm truncate">{phase.name}</span>
                      {phase.project && (
                        <span className="text-xs text-muted-foreground truncate">
                          — {phase.project.name}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Day View ──────────────────────────────────────

function DayView({
  phases,
  date,
  todayStr,
}: {
  phases: (SchedulePhase & { project?: Project })[];
  date: Date;
  todayStr: string;
}) {
  const dateStr = dateToStr(date);
  const isToday = dateStr === todayStr;

  const dayPhases = useMemo(() => {
    return phases.filter(
      (p) => p.start_date <= dateStr && p.end_date >= dateStr
    );
  }, [phases, dateStr]);

  // Group by project
  const byProject = useMemo(() => {
    const map = new Map<
      string,
      { project: Project | undefined; phases: SchedulePhase[] }
    >();
    for (const p of dayPhases) {
      const key = p.project_id || "unassigned";
      if (!map.has(key)) {
        map.set(key, { project: p.project, phases: [] });
      }
      map.get(key)!.phases.push(p);
    }
    return map;
  }, [dayPhases]);

  if (dayPhases.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">Nothing scheduled</p>
        <p className="text-xs mt-1">
          {isToday ? "No phases for today" : `No phases on ${formatShortDate(date)}`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">
          {dayPhases.length} phase{dayPhases.length !== 1 ? "s" : ""}
        </span>
        <span>across {byProject.size} project{byProject.size !== 1 ? "s" : ""}</span>
      </div>

      {/* Phases grouped by project */}
      {Array.from(byProject).map(([projectId, group]) => (
        <div key={projectId}>
          {/* Project header */}
          <div className="flex items-center gap-2 mb-2">
            {group.project ? (
              <Link
                href={`/projects/${projectId}`}
                className="text-sm font-semibold hover:underline"
              >
                {group.project.name}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-muted-foreground">
                Unassigned
              </span>
            )}
            {group.project && (
              <span className="text-xs text-muted-foreground">
                {group.project.project_number}
              </span>
            )}
          </div>

          {/* Phase cards */}
          <div className="space-y-2">
            {group.phases.map((phase) => {
              const startDate = new Date(phase.start_date + "T00:00:00");
              const endDate = new Date(phase.end_date + "T00:00:00");
              const totalDays =
                Math.ceil(
                  (endDate.getTime() - startDate.getTime()) / 86400000
                ) + 1;
              const daysIn =
                Math.ceil(
                  (new Date(dateStr + "T00:00:00").getTime() -
                    startDate.getTime()) /
                    86400000
                ) + 1;
              const progress = Math.round((daysIn / totalDays) * 100);

              return (
                <div
                  key={phase.id}
                  className="rounded-lg border border-border/50 p-3"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: phase.color }}
                      />
                      <h4 className="text-sm font-semibold">{phase.name}</h4>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[phase.status]}`}
                    >
                      {STATUS_LABELS[phase.status]}
                    </span>
                  </div>

                  {/* Date range */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                    <CalendarDays className="h-3 w-3" />
                    <span>
                      {formatShortDate(startDate)} – {formatShortDate(endDate)}
                    </span>
                    <span className="text-muted-foreground/50">·</span>
                    <span>
                      Day {daysIn} of {totalDays}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(progress, 100)}%`,
                        backgroundColor: phase.color,
                      }}
                    />
                  </div>

                  {/* Description */}
                  {phase.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                      {phase.description}
                    </p>
                  )}

                  {/* Notes */}
                  {phase.notes && (
                    <p className="text-xs text-muted-foreground/70 italic line-clamp-2">
                      {phase.notes}
                    </p>
                  )}

                  {/* Project link */}
                  {phase.project_id && (
                    <div className="mt-2 pt-2 border-t border-border/30">
                      <Link
                        href={`/projects/${phase.project_id}`}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <MapPin className="h-3 w-3" />
                        View project
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Legend ──────────────────────────────────────

function PhaseLegend({
  phases,
}: {
  phases: (SchedulePhase & { project?: Project })[];
}) {
  const projectPhases = useMemo(() => {
    const map = new Map<
      string,
      { project: Project | undefined; phases: SchedulePhase[] }
    >();
    for (const p of phases) {
      const key = p.project_id || "unassigned";
      if (!map.has(key)) {
        map.set(key, { project: p.project, phases: [] });
      }
      map.get(key)!.phases.push(p);
    }
    return map;
  }, [phases]);

  if (projectPhases.size === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      {Array.from(projectPhases).map(([projectId, group]) => (
        <div key={projectId} className="flex items-center gap-1.5 text-xs">
          <Link
            href={`/projects/${projectId}`}
            className="font-medium hover:underline"
          >
            {group.project?.name ?? "Unknown Project"}
          </Link>
          <div className="flex gap-0.5">
            {group.phases.map((p) => (
              <div
                key={p.id}
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: p.color }}
                title={p.name}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
