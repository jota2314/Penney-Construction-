"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SchedulePhase, Project } from "@/types/database";

interface ScheduleCalendarProps {
  phases: (SchedulePhase & { project?: Project })[];
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function formatMonthYear(year: number, month: number) {
  return new Date(year, month).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function dateToStr(d: Date) {
  return d.toISOString().split("T")[0];
}

export function ScheduleCalendar({ phases }: ScheduleCalendarProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const todayStr = dateToStr(today);

  // Group phases by project
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

  // For each day, determine which phases are active
  const dayPhases = useMemo(() => {
    const result: Map<number, { phase: SchedulePhase; project?: Project }[]> =
      new Map();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const active: { phase: SchedulePhase; project?: Project }[] = [];
      for (const [, group] of projectPhases) {
        for (const phase of group.phases) {
          if (phase.start_date <= dateStr && phase.end_date >= dateStr) {
            active.push({ phase, project: group.project });
          }
        }
      }
      result.set(d, active);
    }
    return result;
  }, [year, month, daysInMonth, projectPhases]);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <CardTitle className="text-lg">
            {formatMonthYear(year, month)}
          </CardTitle>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
          {/* Day headers */}
          {dayNames.map((d) => (
            <div
              key={d}
              className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground"
            >
              {d}
            </div>
          ))}

          {/* Empty cells before first day */}
          {Array.from({ length: firstDay }, (_, i) => (
            <div key={`empty-${i}`} className="bg-background p-1 min-h-[80px]" />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isToday = dateStr === todayStr;
            const active = dayPhases.get(day) ?? [];

            return (
              <div
                key={day}
                className={`bg-background p-1 min-h-[80px] ${
                  isToday ? "ring-2 ring-primary ring-inset" : ""
                }`}
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
                  {active.slice(0, 3).map(({ phase, project }) => (
                    <Link
                      key={phase.id}
                      href={`/projects/${phase.project_id}`}
                      className="block"
                    >
                      <div
                        className="text-[10px] leading-tight px-1 py-0.5 rounded truncate text-white hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: phase.color }}
                        title={`${phase.name}${project ? ` — ${project.name}` : ""}`}
                      >
                        {phase.name}
                      </div>
                    </Link>
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

        {/* Legend */}
        {projectPhases.size > 0 && (
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
        )}
      </CardContent>
    </Card>
  );
}
