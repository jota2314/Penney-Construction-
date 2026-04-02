"use client";

import { useEffect, useState } from "react";
import { DollarSign, TrendingUp, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";

interface EarningsCardProps {
  hourlyRate: number;
  clockInTime: string | null; // null if not currently clocked in
  todayEarnedCents: number;
  weekEarnedCents: number;
  periodEarnedCents: number; // current pay period
  periodLabel: string; // e.g. "This Pay Period (Mar 24 – Apr 6)"
}

export function EarningsCard({
  hourlyRate,
  clockInTime,
  todayEarnedCents,
  weekEarnedCents,
  periodEarnedCents,
  periodLabel,
}: EarningsCardProps) {
  const [sessionEarnings, setSessionEarnings] = useState(0);
  const [sessionTime, setSessionTime] = useState("");

  const isClockedIn = !!clockInTime;

  useEffect(() => {
    if (!clockInTime) return;
    const start = new Date(clockInTime).getTime();
    const update = () => {
      const ms = Date.now() - start;
      const hours = ms / 3600000;
      setSessionEarnings(hours * hourlyRate);
      // Format elapsed
      const totalSec = Math.floor(ms / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setSessionTime(
        `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [clockInTime, hourlyRate]);

  const todayTotal = todayEarnedCents / 100 + sessionEarnings;
  const weekTotal = weekEarnedCents / 100 + sessionEarnings;
  const periodTotal = periodEarnedCents / 100 + sessionEarnings;

  return (
    <Card className="p-4 mb-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
        <TrendingUp className="h-4 w-4" />
        My Earnings
      </h2>

      {/* Live session — only when clocked in */}
      {isClockedIn && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="relative">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            </div>
            <span className="text-xs font-medium text-green-400">
              EARNING NOW
            </span>
          </div>
          <p className="text-3xl font-mono font-bold text-green-500 mb-1">
            ${sessionEarnings.toFixed(2)}
          </p>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{sessionTime}</span>
            <span className="mx-1">·</span>
            <span>${hourlyRate.toFixed(2)}/hr</span>
          </div>
        </div>
      )}

      {/* Earnings breakdown */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Today</span>
          <span className="text-sm font-mono font-semibold">
            ${todayTotal.toFixed(2)}
          </span>
        </div>
        <div className="h-px bg-border/50" />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">This Week</span>
          <span className="text-sm font-mono font-semibold">
            ${weekTotal.toFixed(2)}
          </span>
        </div>
        <div className="h-px bg-border/50" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{periodLabel}</span>
          <span className="text-base font-mono font-bold text-amber-500">
            ${periodTotal.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Rate */}
      <div className="mt-4 pt-3 border-t border-border/50">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Hourly Rate</span>
          <span className="font-mono">${hourlyRate.toFixed(2)}/hr</span>
        </div>
      </div>
    </Card>
  );
}
