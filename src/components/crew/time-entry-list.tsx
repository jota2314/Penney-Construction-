"use client";

import { Clock } from "lucide-react";

interface TimeEntryData {
  id: string;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
  notes: string | null;
  auto_clocked_out?: boolean;
  projects?: { name: string; project_number: string } | null;
}

interface TimeEntryListProps {
  entries: TimeEntryData[];
  showProject?: boolean;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function calcHours(clockIn: string, clockOut: string | null, breakMin: number): string {
  if (!clockOut) return "Active";
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60000) - breakMin);
  if (ms > 0 && totalMinutes === 0 && breakMin === 0) return "<1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function calcDayTotal(entries: TimeEntryData[]): string {
  let totalMinutes = 0;
  for (const e of entries) {
    if (!e.clock_out) continue;
    const ms = new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime();
    totalMinutes += Math.max(0, Math.floor(ms / 60000) - e.break_minutes);
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export function TimeEntryList({ entries, showProject = false }: TimeEntryListProps) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No time entries yet</p>
      </div>
    );
  }

  // Group entries by date
  const grouped = new Map<string, TimeEntryData[]>();
  for (const entry of entries) {
    const dateKey = formatDate(entry.clock_in);
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey)!.push(entry);
  }

  return (
    <div className="space-y-4">
      {Array.from(grouped.entries()).map(([date, dayEntries]) => (
        <div key={date}>
          <div className="flex items-center justify-between px-1 mb-2">
            <h4 className="text-sm font-medium text-muted-foreground">{date}</h4>
            <span className="text-xs font-medium text-amber-500">
              Total: {calcDayTotal(dayEntries)}
            </span>
          </div>
          <div className="space-y-2">
            {dayEntries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-border/50 bg-card p-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    {showProject && entry.projects && (
                      <p className="text-sm font-medium">
                        {entry.projects.name}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {formatTime(entry.clock_in)}
                      {entry.clock_out
                        ? ` — ${formatTime(entry.clock_out)}`
                        : ""}
                    </p>
                    {entry.break_minutes > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Break: {entry.break_minutes}m
                      </p>
                    )}
                    {entry.auto_clocked_out && (
                      <p className="text-xs text-amber-500 mt-0.5">
                        Auto clocked out — capped at 12h
                      </p>
                    )}
                  </div>
                  <span
                    className={`text-sm font-mono font-medium ${
                      entry.clock_out ? "text-foreground" : "text-green-500"
                    }`}
                  >
                    {calcHours(entry.clock_in, entry.clock_out, entry.break_minutes)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
