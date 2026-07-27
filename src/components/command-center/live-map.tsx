"use client";

import { useEffect, useState } from "react";
import { MapView, type MapPin } from "@/components/field-feed/map-view";
import { PCC_TOKENS, v } from "@/components/field-feed/tokens";
import { MAX_SHIFT_MS } from "@/lib/crew/shift";
import type { FeedLiveShift } from "@/components/field-feed/command-center-feed";

/** Cost accrued so far by one open shift, in cents (capped at the 12h max). */
function shiftLiveCents(shift: FeedLiveShift, now: number): number {
  const ms = Math.min(
    Math.max(now - new Date(shift.clockIn).getTime(), 0),
    MAX_SHIFT_MS,
  );
  return (ms / 3_600_000) * shift.rateCentsPerHour;
}

/**
 * Full-page live map: spending-by-the-second banner, a row per worker on the
 * clock, and the interactive jobsite map (pins, GPS tracking, smart routes).
 */
export function LiveMap({
  pins,
  activeShifts,
  completedTodayCents,
  missingCoordsCount,
  showSpend,
}: {
  pins: MapPin[];
  activeShifts: FeedLiveShift[];
  completedTodayCents: number;
  missingCoordsCount: number;
  showSpend: boolean;
}) {
  // Tick the clock every second while shifts are open so the counters count.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (activeShifts.length === 0 || !showSpend) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeShifts.length, showSpend]);

  const liveCents = activeShifts.reduce(
    (sum, s) => sum + shiftLiveCents(s, now),
    0,
  );
  const todayTotal = (completedTodayCents + liveCents) / 100;
  const onClock = activeShifts.length;

  return (
    <div className="flex flex-col gap-3" style={PCC_TOKENS}>
      {showSpend && (
        <div
          className="rounded-xl p-4"
          style={{
            background:
              "linear-gradient(90deg, rgba(239, 68, 68, 0.10), rgba(217, 119, 6, 0.10))",
            border: "1px solid rgba(239, 68, 68, 0.25)",
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            {onClock > 0 && (
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            )}
            <span
              className="text-[10px] font-semibold uppercase"
              style={{ color: "#f87171", letterSpacing: "0.18em" }}
            >
              {onClock > 0 ? "Spending now" : "Today's labor"}
            </span>
          </div>
          <p className="text-4xl font-mono font-bold" style={{ color: "#ef4444" }}>
            ${todayTotal.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {onClock === 0
              ? "No one on the clock right now"
              : `${onClock} on the clock · counting every second`}
          </p>
        </div>
      )}

      {activeShifts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {activeShifts.map((shift) => (
            <div
              key={shift.id}
              className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
              style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
            >
              <div className="min-w-0">
                <p
                  className="text-[13px] font-semibold truncate"
                  style={{ color: v("ink") }}
                >
                  {shift.name}
                </p>
                <p className="text-[11px] truncate" style={{ color: v("muted") }}>
                  {shift.projectName ?? "Unknown jobsite"}
                </p>
              </div>
              {showSpend && (
                <span
                  className="text-[13px] font-mono font-semibold shrink-0"
                  style={{ color: "#34d399" }}
                >
                  ${(shiftLiveCents(shift, now) / 100).toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <MapView
        pins={pins}
        missingProjectCount={missingCoordsCount}
        // Dedicated map page — fill the window instead of a fixed slab. Floor
        // keeps it usable on a phone, ceiling stops it sprawling on a monitor.
        height="clamp(360px, calc(100vh - 300px), 1000px)"
        liveCrew
      />
    </div>
  );
}
