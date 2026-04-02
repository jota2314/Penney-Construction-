"use client";

import { useEffect, useState } from "react";
import { Clock, MapPin, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clockOut } from "@/lib/actions/time-entries";
import { useRouter } from "next/navigation";

interface ActiveClockBannerProps {
  entryId: string;
  projectName: string;
  clockInTime: string;
  hourlyRate: number;
  todayEarnedCents: number; // earnings from completed entries today (in cents to avoid float issues)
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function calcEarnings(ms: number, hourlyRate: number): number {
  const hours = ms / 3600000;
  return hours * hourlyRate;
}

export function ActiveClockBanner({
  entryId,
  projectName,
  clockInTime,
  hourlyRate,
  todayEarnedCents,
}: ActiveClockBannerProps) {
  const [elapsed, setElapsed] = useState("");
  const [liveEarnings, setLiveEarnings] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const start = new Date(clockInTime).getTime();
    const update = () => {
      const ms = Date.now() - start;
      setElapsed(formatElapsed(ms));
      setLiveEarnings(calcEarnings(ms, hourlyRate));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [clockInTime, hourlyRate]);

  const todayTotal = todayEarnedCents / 100 + liveEarnings;

  async function handleClockOut() {
    setLoading(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 5000,
          })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {
        // GPS not available — continue without
      }
      await clockOut(entryId, lat, lng);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-4 mt-4 rounded-xl bg-amber-500/15 border border-amber-500/30 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Clock className="h-5 w-5 text-amber-500" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-medium">Clocked In</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {projectName}
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-mono font-bold text-amber-500">
            {elapsed}
          </p>
        </div>
      </div>

      {/* Live earnings */}
      <div className="mt-3 rounded-lg bg-green-500/10 border border-green-500/20 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-500" />
            <span className="text-xs text-muted-foreground">This session</span>
          </div>
          <p className="text-lg font-mono font-bold text-green-500">
            ${liveEarnings.toFixed(2)}
          </p>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-muted-foreground">Today&apos;s total</span>
          <p className="text-sm font-mono font-semibold text-green-400">
            ${todayTotal.toFixed(2)}
          </p>
        </div>
      </div>

      <Button
        onClick={handleClockOut}
        disabled={loading}
        className="w-full mt-3 bg-red-600 hover:bg-red-700 text-white"
      >
        {loading ? "Clocking Out..." : "Clock Out"}
      </Button>
    </div>
  );
}
