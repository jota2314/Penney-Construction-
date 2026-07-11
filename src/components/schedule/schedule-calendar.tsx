"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Calendar,
  CalendarPlus,
  CalendarDays,
  Clock,
  MapPin,
  DollarSign,
  FolderTree,
  CheckCircle2,
  Circle,
  PlayCircle,
  PauseCircle,
  ExternalLink,
  Trash2,
} from "lucide-react";
import type { SchedulePhase, Project } from "@/types/database";
import { PhaseDetailPanel } from "./phase-detail-panel";
import { ProjectPicker } from "./project-picker";
import { ScheduleQuickAddSheet } from "./schedule-quick-add-sheet";

interface ScheduleCalendarProps {
  phases: (SchedulePhase & { project?: Project })[];
  allProjects?: { id: string; name: string; project_number: string }[];
}

type ViewMode = "month" | "week" | "day" | "project";

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
    weekday: "short",
    month: "short",
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

export function ScheduleCalendar({ phases, allProjects }: ScheduleCalendarProps) {
  const router = useRouter();
  const today = new Date();
  const todayStr = dateToStr(today);

  const [view, setView] = useState<ViewMode>("week");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(new Date(today));
  const [weekStart, setWeekStart] = useState(getWeekStart(today));
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [showPlanned, setShowPlanned] = useState(false);
  // Live by default: only confirmed (or already-started) phases. Flipping the
  // switch reveals the tentative master plan, rendered dashed.
  const [showTentative, setShowTentative] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // All projects for filter dropdown
  const projectOptions = useMemo(() => {
    if (allProjects && allProjects.length > 0) {
      return allProjects.map((p) => ({
        id: p.id,
        name: p.name,
        project_number: p.project_number,
      }));
    }
    // Fallback: extract from phases
    const map = new Map<
      string,
      { id: string; name: string; project_number?: string | null }
    >();
    for (const p of phases) {
      if (p.project_id && p.project) {
        map.set(p.project_id, {
          id: p.project_id,
          name: p.project.name,
          project_number: p.project.project_number,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [phases, allProjects]);

  // Filter phases by selected project + live/tentative switch
  const filteredPhases = useMemo(() => {
    // Firm = live schedule: confirmed, or work that already started/finished.
    const isFirm = (p: SchedulePhase) =>
      p.is_confirmed || p.status === "in_progress" || p.status === "completed";

    let base = projectFilter === "all" ? phases : phases.filter((p) => p.project_id === projectFilter);
    base = showTentative ? base : base.filter(isFirm);

    if (!showPlanned) {
      return base.map((p) => ({ ...p, isTentative: !isFirm(p) }));
    }

    // In compare mode: add ghost entries for planned dates that differ from actual
    const result: (SchedulePhase & { project?: Project; isPlanned?: boolean; isTentative?: boolean; variance?: number })[] = [];

    for (const phase of base) {
      const p = phase as SchedulePhase & { planned_start_date?: string; planned_end_date?: string };
      const hasPlanned = p.planned_start_date && p.planned_end_date;
      const datesDiffer = hasPlanned && (p.planned_start_date !== p.start_date || p.planned_end_date !== p.end_date);

      // Calculate variance in days (positive = behind, negative = ahead)
      let variance = 0;
      if (hasPlanned) {
        const plannedEnd = new Date(p.planned_end_date!).getTime();
        const actualEnd = new Date(p.end_date).getTime();
        variance = Math.round((actualEnd - plannedEnd) / (1000 * 60 * 60 * 24));
      }

      // Add the actual phase with variance info
      result.push({ ...phase, isPlanned: false, isTentative: !isFirm(phase), variance });

      // Add planned ghost if dates differ
      if (datesDiffer) {
        result.push({
          ...phase,
          id: `planned-${phase.id}`,
          start_date: p.planned_start_date!,
          end_date: p.planned_end_date!,
          name: `${phase.name} (planned)`,
          isPlanned: true,
          variance: 0,
        });
      }
    }

    return result;
  }, [phases, projectFilter, showPlanned, showTentative]);

  // Track status for filtered project
  const trackingStats = useMemo(() => {
    if (projectFilter === "all") return null;
    const projectPhases = phases.filter((p) => p.project_id === projectFilter);
    const total = projectPhases.length;
    const completed = projectPhases.filter((p) => p.status === "completed").length;
    const inProgress = projectPhases.filter((p) => p.status === "in_progress").length;
    const overdue = projectPhases.filter(
      (p) => p.status !== "completed" && p.end_date < todayStr
    ).length;
    const upcoming = projectPhases.filter(
      (p) => p.status === "not_started" && p.start_date > todayStr
    ).length;
    const onHold = projectPhases.filter((p) => p.status === "on_hold").length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, overdue, upcoming, onHold, progress };
  }, [phases, projectFilter, todayStr]);

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

  function handleScheduleCreated(projectId: string, date: string) {
    setProjectFilter(projectId);
    setSelectedDate(new Date(`${date}T00:00:00`));
    setView("day");
  }

  const viewTabs: { key: ViewMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "month", label: "Month", icon: Calendar },
    { key: "week", label: "Week", icon: CalendarDays },
    { key: "day", label: "Day", icon: Clock },
    { key: "project", label: "Project", icon: FolderTree },
  ];

  return (
    <>
      <div className="flex w-full min-w-0 max-w-full flex-1 flex-col gap-3">
        {/* Toolbar: project filter + add + view tabs */}
        <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2 lg:flex-1">
            <ProjectPicker
              projects={projectOptions}
              value={projectFilter}
              onValueChange={setProjectFilter}
              allowAll
              className="h-10 min-w-0 flex-1 lg:max-w-[280px]"
            />
            <Button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="h-10 shrink-0 gap-1.5 bg-amber-600 px-3 hover:bg-amber-700"
            >
              <CalendarPlus className="h-4 w-4" />
              <span className="sm:hidden">Add</span>
              <span className="hidden sm:inline">Add schedule</span>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {/* Live / master-plan switch — live shows only confirmed work */}
            <Button
              variant={showTentative ? "default" : "outline"}
              size="sm"
              onClick={() => setShowTentative(!showTentative)}
              className={`shrink-0 gap-1.5 text-xs ${showTentative ? "bg-amber-600 hover:bg-amber-700" : "text-emerald-500 border-emerald-500/40"}`}
              title={
                showTentative
                  ? "Showing the full plan including tentative phases"
                  : "Showing the live schedule (confirmed work only)"
              }
            >
              {showTentative ? "Plan" : "Live"}
            </Button>
            {/* Compare toggle — desktop only */}
            <div className="hidden items-center gap-2 sm:flex">
              <Button
                variant={showPlanned ? "default" : "outline"}
                size="sm"
                onClick={() => setShowPlanned(!showPlanned)}
                className={`gap-1.5 text-xs ${showPlanned ? "bg-violet-600 hover:bg-violet-700" : ""}`}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                {showPlanned ? "Comparing" : "Compare"}
              </Button>
            </div>
            <div
              className="grid min-w-0 flex-1 grid-cols-4 gap-1 rounded-xl bg-muted/40 p-1"
              role="group"
              aria-label="Schedule view"
            >
              {viewTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setView(tab.key)}
                  className={`flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors sm:px-3 ${
                    view === tab.key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <tab.icon className="hidden h-3.5 w-3.5 sm:block" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Project tracking bar — only when a project is selected */}
        {trackingStats && (
          <div className="shrink-0 space-y-2 rounded-xl border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium">
                {projectOptions.find((p) => p.id === projectFilter)?.name}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {trackingStats.progress}% complete
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${trackingStats.progress}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {trackingStats.completed > 0 && (
                <span className="text-emerald-400">
                  {trackingStats.completed} done
                </span>
              )}
              {trackingStats.inProgress > 0 && (
                <span className="text-blue-400">
                  {trackingStats.inProgress} in progress
                </span>
              )}
              {trackingStats.upcoming > 0 && (
                <span className="text-muted-foreground">
                  {trackingStats.upcoming} upcoming
                </span>
              )}
              {trackingStats.overdue > 0 && (
                <span className="font-medium text-red-400">
                  {trackingStats.overdue} overdue
                </span>
              )}
              {trackingStats.onHold > 0 && (
                <span className="text-amber-400">
                  {trackingStats.onHold} on hold
                </span>
              )}
            </div>
          </div>
        )}

        {/* Period navigation */}
        <div className="flex shrink-0 items-center justify-between gap-3">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold sm:text-xl">
            {periodLabel}
          </h2>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={goToToday}
              className="h-9 rounded-lg px-3 text-xs"
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={prevPeriod}
              aria-label="Previous period"
              className="h-9 w-9 rounded-lg"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={nextPeriod}
              aria-label="Next period"
              className="h-9 w-9 rounded-lg"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex min-w-0 max-w-full flex-1 flex-col">
          {view === "month" && (
            <MonthView
              phases={filteredPhases}
              year={year}
              month={month}
              todayStr={todayStr}
              onSelectDay={selectDay}
            />
          )}
          {view === "week" && (
            <WeekView
              phases={filteredPhases}
              weekStart={weekStart}
              todayStr={todayStr}
              onSelectDay={selectDay}
            />
          )}
          {view === "day" && (
            <DayView
              phases={filteredPhases}
              date={selectedDate}
              todayStr={todayStr}
              onRefresh={() => router.refresh()}
              onAdd={() => setQuickAddOpen(true)}
            />
          )}
          {view === "project" && (
            <ProjectTimelineView phases={filteredPhases} todayStr={todayStr} />
          )}

          {/* Tentative legend */}
          {showTentative && (
            <div className="flex shrink-0 items-center gap-4 pt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-6 rounded bg-amber-500" />
                <span>Live (confirmed)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-6 rounded border border-dashed border-amber-500 bg-amber-500/40 opacity-60" />
                <span>Tentative — confirm on the project&apos;s Schedule tab to put it live</span>
              </div>
            </div>
          )}

          {/* Compare legend */}
          {showPlanned && (
            <div className="flex shrink-0 items-center gap-4 pt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-6 rounded bg-violet-500" />
                <span>Actual</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-6 rounded border border-dashed border-violet-500 opacity-40" />
                <span>Planned</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-red-400">+3d</span>
                <span>= 3 days behind</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-emerald-400">-2d</span>
                <span>= 2 days ahead</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {quickAddOpen && (
        <ScheduleQuickAddSheet
          open
          onOpenChange={setQuickAddOpen}
          projects={projectOptions}
          initialProjectId={projectFilter === "all" ? undefined : projectFilter}
          defaultDate={dateToStr(selectedDate)}
          onCreated={handleScheduleCreated}
        />
      )}
    </>
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
    <div className="max-w-full min-w-0 flex-1 overflow-x-auto overscroll-x-contain rounded-lg">
      <div className="grid min-h-[500px] min-w-[700px] grid-cols-7 gap-px overflow-hidden rounded-lg bg-border">
      {dayNames.map((d) => (
        <div
          key={d}
          className="bg-muted p-2 text-center text-sm font-medium text-muted-foreground"
        >
          {d}
        </div>
      ))}

      {Array.from({ length: firstDay }, (_, i) => (
        <div key={`empty-${i}`} className="bg-background p-1" />
      ))}

      {Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const isToday = dateStr === todayStr;
        const active = dayPhases.get(day) ?? [];

        return (
          <div
            key={day}
            className={`bg-background p-1 cursor-pointer hover:bg-muted/50 transition-colors ${
              isToday ? "ring-2 ring-primary ring-inset" : ""
            }`}
            onClick={() => onSelectDay(new Date(year, month, day))}
          >
            <div
              className={`text-sm font-medium mb-1 ${
                isToday
                  ? "bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center"
                  : "text-muted-foreground"
              }`}
            >
              {day}
            </div>
            <div className="space-y-1">
              {active.slice(0, 3).map((phase) => {
                const p = phase as typeof phase & { isPlanned?: boolean; isTentative?: boolean };
                return (
                  <div
                    key={phase.id}
                    className={`text-xs leading-tight px-1.5 py-1 rounded-md truncate font-medium ${
                      p.isPlanned
                        ? "border border-dashed opacity-40 text-white"
                        : p.isTentative
                          ? "border border-dashed opacity-50 text-white"
                          : "text-white"
                    }`}
                    style={{
                      backgroundColor: p.isPlanned ? "transparent" : phase.color,
                      borderColor: p.isPlanned || p.isTentative ? phase.color : undefined,
                    }}
                    title={`${phase.name}${phase.project ? ` — ${phase.project.name}` : ""}${p.isTentative ? " (tentative — not confirmed)" : ""}`}
                  >
                    {phase.name}
                  </div>
                );
              })}
              {active.length > 3 && (
                <div className="text-xs text-muted-foreground px-1">
                  +{active.length - 3} more
                </div>
              )}
            </div>
          </div>
        );
      })}
      </div>
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
    <div className="flex flex-col flex-1 min-h-0">
      {/* Desktop: horizontal columns — stretches to fill available height */}
      <div className="hidden min-h-[480px] md:grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden flex-1">
        {dayData.map(({ date, dateStr, phases: dayPhases }) => {
          const isToday = dateStr === todayStr;
          return (
            <div
              key={dateStr}
              className={`bg-background p-2 cursor-pointer hover:bg-muted/50 transition-colors flex flex-col ${
                isToday ? "ring-2 ring-primary ring-inset" : ""
              }`}
              onClick={() => onSelectDay(date)}
            >
              <div className="text-center mb-1 shrink-0">
                <div className="text-xs text-muted-foreground">
                  {formatDayName(date)}
                </div>
                <div
                  className={`text-lg font-bold ${
                    isToday
                      ? "bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center mx-auto"
                      : ""
                  }`}
                >
                  {date.getDate()}
                </div>
              </div>
              <div className="space-y-0.5 flex-1 overflow-y-auto min-h-0">
                {dayPhases.map((phase) => {
                  const p = phase as typeof phase & { isPlanned?: boolean; isTentative?: boolean; variance?: number };
                  const isPlanned = p.isPlanned;
                  const variance = p.variance || 0;
                  const varianceLabel = variance > 0 ? `+${variance}d` : variance < 0 ? `${variance}d` : "";
                  return (
                    <div
                      key={phase.id}
                      className={`text-[11px] leading-tight px-1.5 py-0.5 rounded font-medium truncate ${
                        isPlanned
                          ? "border border-dashed opacity-40 text-white"
                          : p.isTentative
                            ? "border border-dashed opacity-50 text-white"
                            : "text-white"
                      }`}
                      style={{
                        backgroundColor: isPlanned ? "transparent" : phase.color,
                        borderColor: isPlanned || p.isTentative ? phase.color : undefined,
                      }}
                      title={`${phase.name}${phase.project ? ` — ${phase.project.name}` : ""}${varianceLabel ? ` (${varianceLabel})` : ""}${p.isTentative ? " (tentative — not confirmed)" : ""}`}
                    >
                      {phase.name}{!isPlanned && varianceLabel ? ` ${varianceLabel}` : ""}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile: clean stacked day rows */}
      <div className="space-y-2 md:hidden">
        {dayData.map(({ date, dateStr, phases: dayPhases }) => {
          const isToday = dateStr === todayStr;
          // Filter out planned ghost phases on mobile
          const realPhases = dayPhases.filter(
            (p) => !(p as typeof p & { isPlanned?: boolean }).isPlanned
          );
          return (
            <div
              key={dateStr}
              className={`cursor-pointer rounded-lg border p-3 transition-colors active:bg-muted/50 ${
                isToday
                  ? "border-primary bg-primary/5"
                  : "border-border/50"
              }`}
              onClick={() => onSelectDay(date)}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={`text-sm font-semibold ${isToday ? "text-primary" : ""}`}
                  >
                    {formatDayName(date)}
                  </span>
                  <span className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatShortDate(date)}
                  </span>
                  {isToday && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                      Today
                    </span>
                  )}
                </div>
                {realPhases.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {realPhases.length}
                  </span>
                )}
              </div>
              {realPhases.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 italic">
                  Nothing scheduled
                </p>
              ) : (
                <div className="min-w-0 space-y-1.5">
                  {realPhases.map((phase) => (
                    <div
                      key={phase.id}
                      className="min-w-0 overflow-hidden rounded-md border border-border/50 border-l-4 bg-muted/30 px-2.5 py-1.5"
                      style={{ borderLeftColor: phase.color }}
                      title={`${phase.project?.name ? `${phase.project.name} — ` : ""}${phase.name}`}
                    >
                      {phase.project?.name && (
                        <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {phase.project.name}
                        </div>
                      )}
                      <div className="truncate text-xs font-medium text-foreground">
                        {phase.name}
                      </div>
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
  onRefresh,
  onAdd,
}: {
  phases: (SchedulePhase & { project?: Project })[];
  date: Date;
  todayStr: string;
  onRefresh?: () => void;
  onAdd?: () => void;
}) {
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const dateStr = dateToStr(date);
  const isToday = dateStr === todayStr;

  const dayPhases = useMemo(() => {
    return phases.filter(
      (p) =>
        !(p as SchedulePhase & { isPlanned?: boolean }).isPlanned &&
        p.start_date <= dateStr &&
        p.end_date >= dateStr
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
      <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
        <CalendarDays className="h-10 w-10 opacity-30" />
        <div>
          <p className="text-sm font-medium">Nothing scheduled</p>
          <p className="mt-1 text-xs">
            {isToday ? "No phases for today" : `No phases on ${formatShortDate(date)}`}
          </p>
        </div>
        {onAdd && (
          <Button variant="outline" size="sm" onClick={onAdd} className="gap-1.5">
            <CalendarPlus className="h-3.5 w-3.5" />
            Add schedule
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
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
          <div className="space-y-2 min-w-0">
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

              const isExpanded = expandedPhase === phase.id;

              return (
                <div
                  key={phase.id}
                  className={`min-w-0 overflow-hidden rounded-xl border transition-colors ${
                    isExpanded
                      ? "border-primary/40 bg-muted/10"
                      : "border-border/60 hover:border-border"
                  }`}
                >
                  <div
                    className="flex cursor-pointer gap-3 p-3 active:bg-muted/30"
                    onClick={() => setExpandedPhase(isExpanded ? null : phase.id)}
                  >
                    <div
                      className="w-1 shrink-0 self-stretch rounded-full"
                      style={{ backgroundColor: phase.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="min-w-0 flex-1 text-sm font-semibold leading-snug">
                          {phase.name}
                          {phase.estimate_line_item_id && (
                            <DollarSign className="ml-1 inline h-3 w-3 text-green-500" />
                          )}
                        </h4>
                        <select
                          value={phase.status}
                          onChange={async (e) => {
                            e.stopPropagation();
                            const newStatus = e.target.value;
                            try {
                              const supabase = (await import("@/lib/supabase/client")).createClient();
                              const { error } = await supabase
                                .from("schedule_phases")
                                .update({ status: newStatus })
                                .eq("id", phase.id);
                              if (error) console.error("Status update failed:", error);
                            } catch (err) {
                              console.error("Status update error:", err);
                            }
                            onRefresh?.();
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Phase status"
                          className={`h-6 shrink-0 appearance-none rounded-full border px-2.5 text-[11px] font-medium outline-none ${
                            STATUS_COLORS[phase.status] ??
                            "border-border bg-muted text-muted-foreground"
                          }`}
                        >
                          <option value="not_started">Not Started</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Done</option>
                          <option value="on_hold">On Hold</option>
                        </select>
                      </div>

                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatShortDate(startDate)} – {formatShortDate(endDate)}
                        <span className="mx-1.5 text-muted-foreground/50">·</span>
                        Day {daysIn} of {totalDays}
                      </div>

                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(progress, 100)}%`,
                            backgroundColor: phase.color,
                          }}
                        />
                      </div>

                      {/* Notes (show description OR notes, not both) */}
                      {(phase.notes || phase.description) && (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {phase.notes || phase.description}
                        </p>
                      )}
                    </div>
                    <ChevronDown
                      className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </div>

                  {/* Expanded: budget/cost detail + actions */}
                  {isExpanded && (
                    <div
                      className="space-y-3 border-t border-border/40 p-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <PhaseDetailPanel phaseId={phase.id} />
                      <div className="flex items-center justify-between">
                        {phase.project_id ? (
                          <Link
                            href={`/projects/${phase.project_id}`}
                            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <MapPin className="h-3 w-3" />
                            View project
                          </Link>
                        ) : (
                          <span />
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm(`Delete "${phase.name}"?`)) return;
                            try {
                              const supabase = (await import("@/lib/supabase/client")).createClient();
                              await supabase.from("schedule_phases").delete().eq("id", phase.id);
                            } catch (err) {
                              console.error("Delete error:", err);
                            }
                            onRefresh?.();
                          }}
                          className="flex items-center gap-1 text-xs font-medium text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
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

// ── Project timeline view ──────────────────────────────────────
//
// Groups all phases by project. Each project gets a vertical timeline
// of its phases with a status dot, dates, "Day X of Y" relative to
// today, and a progress bar. Status counts ("today") shown at the top.

function ProjectTimelineView({
  phases,
  todayStr,
}: {
  phases: (SchedulePhase & { project?: Project })[];
  todayStr: string;
}) {
  // Phases active "today" for the stats row.
  const todayPhases = phases.filter((p) => p.start_date <= todayStr && p.end_date >= todayStr);
  const stats = {
    total: todayPhases.length,
    completed: todayPhases.filter((p) => p.status === "completed").length,
    inProgress: todayPhases.filter((p) => p.status === "in_progress").length,
    notStarted: todayPhases.filter((p) => p.status === "not_started").length,
  };

  // Group all phases by project, sorted by start date.
  const byProject = useMemo(() => {
    const map = new Map<string, { project?: Project; phases: (SchedulePhase & { project?: Project })[] }>();
    for (const ph of phases) {
      if (!ph.project_id) continue;
      const entry = map.get(ph.project_id) ?? { project: ph.project, phases: [] };
      entry.phases.push(ph);
      map.set(ph.project_id, entry);
    }
    for (const entry of map.values()) {
      entry.phases.sort((a, b) => a.start_date.localeCompare(b.start_date));
    }
    const projectsCount = new Set(phases.map((p) => p.project_id).filter(Boolean)).size;
    return { entries: Array.from(map.entries()), projectsCount };
  }, [phases]);

  return (
    <div className="space-y-4 pb-4">
      <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-4 sm:gap-2">
        <StatTile color="violet" icon={FolderTree} value={stats.total} label="Phases" sub={`Across ${byProject.projectsCount} project${byProject.projectsCount === 1 ? "" : "s"}`} />
        <StatTile color="green" icon={CheckCircle2} value={stats.completed} label="Completed" sub="Today" />
        <StatTile color="amber" icon={PlayCircle} value={stats.inProgress} label="In Progress" sub="Today" />
        <StatTile color="zinc" icon={Circle} value={stats.notStarted} label="Not Started" sub="Today" />
      </div>

      {byProject.entries.length === 0 && (
        <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          No phases scheduled.
        </div>
      )}

      {byProject.entries.map(([projectId, entry]) => (
        <div key={projectId} className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
            <div className="min-w-0">
              <div className="text-base font-semibold truncate">{entry.project?.name ?? "Project"}</div>
              {entry.project?.project_number && (
                <div className="text-xs text-muted-foreground/70 mt-0.5">{entry.project.project_number}</div>
              )}
            </div>
            <Link
              href={`/projects/${projectId}`}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border hover:bg-muted/40 transition-colors flex-shrink-0"
            >
              View project
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          <div className="px-4 py-3">
            {entry.phases.map((phase, i) => (
              <PhaseTimelineRow
                key={phase.id}
                phase={phase}
                isLast={i === entry.phases.length - 1}
                todayStr={todayStr}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatTile({
  icon: Icon,
  value,
  label,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  sub: string;
  color: "violet" | "green" | "amber" | "zinc";
}) {
  const tones: Record<string, string> = {
    violet: "bg-violet-500/15 text-violet-400",
    green: "bg-emerald-500/15 text-emerald-400",
    amber: "bg-amber-500/15 text-amber-400",
    zinc: "bg-zinc-500/15 text-zinc-400",
  };
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`flex-shrink-0 h-9 w-9 rounded-lg flex items-center justify-center ${tones[color]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold leading-none">{value}</div>
        <div className="text-[11px] font-medium leading-tight mt-1 truncate">{label}</div>
        <div className="text-[10px] text-muted-foreground/70 truncate">{sub}</div>
      </div>
    </div>
  );
}

function PhaseTimelineRow({
  phase,
  isLast,
  todayStr,
}: {
  phase: SchedulePhase & { project?: Project };
  isLast: boolean;
  todayStr: string;
}) {
  const dotConfig: Record<string, { Icon: React.ComponentType<{ className?: string }>; color: string; ring: string }> = {
    completed:    { Icon: CheckCircle2, color: "text-emerald-400", ring: "bg-emerald-500" },
    in_progress:  { Icon: PlayCircle,   color: "text-amber-400",   ring: "bg-amber-500" },
    on_hold:      { Icon: PauseCircle,  color: "text-orange-400",  ring: "bg-orange-500" },
    not_started:  { Icon: Circle,       color: "text-zinc-500",    ring: "bg-zinc-700" },
  };
  const cfg = dotConfig[phase.status] ?? dotConfig.not_started;

  const start = new Date(phase.start_date + "T00:00:00").getTime();
  const end = new Date(phase.end_date + "T00:00:00").getTime();
  const today = new Date(todayStr + "T00:00:00").getTime();
  const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const daysIn = Math.min(totalDays, Math.max(1, Math.round((today - start) / 86400000) + 1));
  const isActive = today >= start && today <= end;

  const formatRange = () => {
    const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return phase.start_date === phase.end_date ? fmt(phase.start_date) : `${fmt(phase.start_date)} – ${fmt(phase.end_date)}`;
  };

  const progress =
    phase.status === "completed" ? 1 :
    phase.status === "not_started" ? 0 :
    isActive ? Math.min(1, daysIn / totalDays) :
    today > end ? 1 : 0;

  return (
    <div className="flex gap-3 relative">
      <div className="flex flex-col items-center flex-shrink-0">
        <cfg.Icon className={`h-5 w-5 ${cfg.color}`} />
        {!isLast && <div className={`w-px flex-1 mt-1 ${cfg.ring} opacity-40`} />}
      </div>
      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{phase.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {formatRange()}
              {isActive && (
                <span className="ml-2">· Day {daysIn} of {totalDays}</span>
              )}
            </div>
          </div>
          <span className={`flex-shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_COLORS[phase.status] ?? ""}`}>
            {STATUS_LABELS[phase.status] ?? phase.status}
          </span>
        </div>
        {phase.notes && (
          <div className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">{phase.notes}</div>
        )}
        {progress > 0 && progress < 1 && (
          <div className="h-1 mt-2 rounded-full overflow-hidden bg-muted/40">
            <div
              className={`h-full rounded-full ${cfg.ring}`}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
