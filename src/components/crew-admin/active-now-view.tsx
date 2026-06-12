"use client";

import { useEffect, useState } from "react";
import { Clock, User, MapPin, DollarSign, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDistance } from "@/lib/crew/geo";

interface ActiveEntry {
  id: string;
  clock_in: string;
  employees: { first_name: string; last_name: string; hourly_rate: number | null } | null;
  projects: { name: string; project_number: string } | null;
  [key: string]: unknown;
}

interface TodayEntry {
  id: string;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
  employees: { first_name: string; last_name: string; hourly_rate: number | null } | null;
  projects: { name: string; project_number: string } | null;
  [key: string]: unknown;
}

interface ActiveNowViewProps {
  activeEntries: ActiveEntry[];
  todayEntries: TodayEntry[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function calcCompletedCost(entries: TodayEntry[]): number {
  let total = 0;
  for (const e of entries) {
    if (!e.clock_out || !e.employees?.hourly_rate) continue;
    const ms = new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime();
    const hours = ms / 3600000 - (e.break_minutes || 0) / 60;
    total += hours * e.employees.hourly_rate;
  }
  return total;
}

function calcCompletedHours(entries: TodayEntry[]): number {
  let totalMin = 0;
  for (const e of entries) {
    const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
    const ms = end - new Date(e.clock_in).getTime();
    totalMin += Math.floor(ms / 60000) - (e.break_minutes || 0);
  }
  return totalMin;
}

export function ActiveNowView({ activeEntries, todayEntries }: ActiveNowViewProps) {
  const [tick, setTick] = useState(0);

  // Tick every second to update live costs
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Calculate live active cost
  let activeCost = 0;
  const activeWorkerCosts: { id: string; name: string; project: string; elapsed: string; cost: number; rate: number; clockIn: string; onSite: boolean | null; distanceM: number | null }[] = [];

  for (const entry of activeEntries) {
    const rate = entry.employees?.hourly_rate || 0;
    const ms = Date.now() - new Date(entry.clock_in).getTime();
    const hours = ms / 3600000;
    const cost = hours * rate;
    activeCost += cost;

    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    activeWorkerCosts.push({
      id: entry.id,
      name: entry.employees ? `${entry.employees.first_name} ${entry.employees.last_name}` : "Unknown",
      project: entry.projects?.name || "Unknown",
      elapsed: `${h}h ${m}m ${s}s`,
      cost,
      rate,
      clockIn: entry.clock_in,
      onSite: (entry.clock_in_on_site as boolean | null) ?? null,
      distanceM: (entry.clock_in_distance_m as number | null) ?? null,
    });
  }

  const completedCost = calcCompletedCost(todayEntries);
  const totalCostToday = completedCost + activeCost;
  const totalMinutes = calcCompletedHours(todayEntries);

  // Suppress lint for tick (used to force re-render)
  void tick;

  return (
    <div className="space-y-6">
      {/* Live spending banner */}
      <div className="rounded-xl bg-gradient-to-r from-red-500/10 to-amber-500/10 border border-red-500/20 p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="relative">
            <DollarSign className="h-5 w-5 text-red-500" />
            {activeEntries.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            )}
          </div>
          <span className="text-xs font-medium text-red-400 uppercase tracking-wide">
            {activeEntries.length > 0 ? "Spending Now" : "Today\u2019s Labor"}
          </span>
        </div>
        <p className="text-4xl font-mono font-bold text-red-500">
          ${totalCostToday.toFixed(2)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Today&apos;s total labor cost
          {activeCost > 0 && (
            <span className="text-red-400 ml-1">
              (${activeCost.toFixed(2)} active right now)
            </span>
          )}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-green-500">
            {activeEntries.length}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">Clocked In</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-amber-500">
            {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">Hours Today</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-red-400">
            ${totalCostToday.toFixed(0)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">Labor Cost</p>
        </Card>
      </div>

      {/* Active workers with live cost per worker */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          On Site Right Now
        </h3>
        {activeWorkerCosts.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No one clocked in right now</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {activeWorkerCosts.map((w) => (
              <Card key={w.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <User className="h-5 w-5 text-muted-foreground" />
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{w.name}</p>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {w.project}
                      </div>
                      {w.onSite === false && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-red-500/15 text-red-500">
                          ⚠ Off-site{w.distanceM != null ? ` · ${formatDistance(w.distanceM)}` : ""}
                        </span>
                      )}
                      {w.onSite === true && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-green-500/15 text-green-600 dark:text-green-400">
                          ✓ On site
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-bold text-red-500">
                      ${w.cost.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {w.elapsed} · ${w.rate}/hr
                    </p>
                  </div>
                </div>
              </Card>
            ))}
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
              const emp = entry.employees;
              const proj = entry.projects;
              const clockOut = entry.clock_out;
              const rate = emp?.hourly_rate || 0;

              let entryCost = 0;
              if (clockOut) {
                const ms = new Date(clockOut).getTime() - new Date(entry.clock_in).getTime();
                const hours = ms / 3600000 - (entry.break_minutes || 0) / 60;
                entryCost = hours * rate;
              }

              return (
                <Card key={entry.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {emp ? `${emp.first_name} ${emp.last_name}` : "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {proj?.name} &middot;{" "}
                        {formatTime(entry.clock_in)}
                        {clockOut ? ` — ${formatTime(clockOut)}` : " (active)"}
                      </p>
                    </div>
                    <div className="text-right">
                      {clockOut ? (
                        <>
                          <span className="text-xs font-mono text-muted-foreground">
                            {(() => {
                              const ms = new Date(clockOut).getTime() - new Date(entry.clock_in).getTime();
                              const min = Math.floor(ms / 60000) - (entry.break_minutes || 0);
                              return `${Math.floor(min / 60)}h ${min % 60}m`;
                            })()}
                          </span>
                          {entryCost > 0 && (
                            <p className="text-[10px] font-mono text-muted-foreground">
                              ${entryCost.toFixed(2)}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-xs font-mono text-green-500">Active</span>
                      )}
                    </div>
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
