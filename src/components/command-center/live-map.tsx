"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapView, type MapPin } from "@/components/field-feed/map-view";
import { PCC_TOKENS } from "@/components/field-feed/tokens";
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
 * Full-page live map: spending-by-the-second banner, then the interactive
 * jobsite map (pins, GPS tracking, smart routes) with one roster of everyone
 * on the clock underneath it.
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

  // A map left up on a desk has to notice clock-ins and clock-outs. Crew
  // positions poll on their own; this re-pulls the shifts and the pin counts.
  const router = useRouter();
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 120_000);
    return () => clearInterval(interval);
  }, [router]);

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
          className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
          style={{
            background:
              "linear-gradient(90deg, rgba(239, 68, 68, 0.10), rgba(217, 119, 6, 0.10))",
            border: "1px solid rgba(239, 68, 68, 0.25)",
          }}
        >
          <div>
            <div className="flex items-center gap-2">
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
            <p className="text-xs text-muted-foreground mt-1">
              {onClock === 0
                ? "No one on the clock right now"
                : `${onClock} on the clock · counting every second`}
            </p>
          </div>
          {/* Ticks every second, so server and browser never agree on it. */}
          <p
            className="text-3xl font-mono font-bold"
            style={{ color: "#ef4444" }}
            suppressHydrationWarning
          >
            ${todayTotal.toFixed(2)}
          </p>
        </div>
      )}

      <MapView
        pins={pins}
        missingProjectCount={missingCoordsCount}
        // Dedicated map page — fill the window instead of a fixed slab. Floor
        // keeps it usable on a phone, ceiling stops it sprawling on a monitor.
        height="clamp(360px, calc(100vh - 290px), 1000px)"
        liveCrew
        jobLinks
        clockedIn={activeShifts.map((shift) => ({
          id: shift.id,
          name: shift.name,
          projectName: shift.projectName,
          amount:
            showSpend && shift.rateCentsPerHour > 0
              ? `$${(shiftLiveCents(shift, now) / 100).toFixed(2)}`
              : undefined,
        }))}
      />
    </div>
  );
}
