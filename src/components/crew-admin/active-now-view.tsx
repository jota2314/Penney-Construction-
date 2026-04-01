"use client";

import { Clock, User, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";

interface ActiveNowViewProps {
  activeEntries: Record<string, unknown>[];
  todayEntries: Record<string, unknown>[];
}

function formatElapsed(clockIn: string): string {
  const ms = Date.now() - new Date(clockIn).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ActiveNowView({
  activeEntries,
  todayEntries,
}: ActiveNowViewProps) {
  // Calculate today's total hours
  let totalMinutes = 0;
  for (const e of todayEntries) {
    const clockIn = e.clock_in as string;
    const clockOut = e.clock_out as string | null;
    const end = clockOut ? new Date(clockOut).getTime() : Date.now();
    const ms = end - new Date(clockIn).getTime();
    totalMinutes += Math.floor(ms / 60000) - ((e.break_minutes as number) || 0);
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-green-500">
            {activeEntries.length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Clocked In Now</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-amber-500">
            {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m
          </p>
          <p className="text-xs text-muted-foreground mt-1">Total Hours Today</p>
        </Card>
      </div>

      {/* Active workers */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">
          On Site Right Now
        </h3>
        {activeEntries.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No one clocked in right now</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {activeEntries.map((entry) => {
              const emp = entry.employees as {
                first_name: string;
                last_name: string;
              } | null;
              const proj = entry.projects as {
                name: string;
                project_number: string;
              } | null;

              return (
                <Card key={entry.id as string} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <User className="h-5 w-5 text-muted-foreground" />
                        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {emp
                            ? `${emp.first_name} ${emp.last_name}`
                            : "Unknown"}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {proj?.name || "Unknown project"}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono font-medium text-green-500">
                        {formatElapsed(entry.clock_in as string)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        since {formatTime(entry.clock_in as string)}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Today's log */}
      {todayEntries.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Today&apos;s Activity ({todayEntries.length} entries)
          </h3>
          <div className="space-y-2">
            {todayEntries.map((entry) => {
              const emp = entry.employees as {
                first_name: string;
                last_name: string;
              } | null;
              const proj = entry.projects as {
                name: string;
                project_number: string;
              } | null;
              const clockOut = entry.clock_out as string | null;

              return (
                <Card key={entry.id as string} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {emp
                          ? `${emp.first_name} ${emp.last_name}`
                          : "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {proj?.name} &middot;{" "}
                        {formatTime(entry.clock_in as string)}
                        {clockOut ? ` — ${formatTime(clockOut)}` : " (active)"}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-mono ${clockOut ? "text-muted-foreground" : "text-green-500"}`}
                    >
                      {clockOut
                        ? (() => {
                            const ms =
                              new Date(clockOut).getTime() -
                              new Date(entry.clock_in as string).getTime();
                            const min =
                              Math.floor(ms / 60000) -
                              ((entry.break_minutes as number) || 0);
                            return `${Math.floor(min / 60)}h ${min % 60}m`;
                          })()
                        : "Active"}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
