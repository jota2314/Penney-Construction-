"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Clock, DollarSign } from "lucide-react";
import { clockIn, clockOut } from "@/lib/actions/time-entries";
import { useRouter } from "next/navigation";

interface ClockInOutButtonProps {
  employeeId: string;
  projectId: string;
  activeEntryId?: string | null;
  activeEntryProjectId?: string | null;
  activeClockIn?: string | null;
  hourlyRate?: number;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function ClockInOutButton({
  employeeId,
  projectId,
  activeEntryId,
  activeEntryProjectId,
  activeClockIn,
  hourlyRate = 0,
}: ClockInOutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState("");
  const [liveEarnings, setLiveEarnings] = useState(0);
  const router = useRouter();

  const isClockedInHere = activeEntryId && activeEntryProjectId === projectId;
  const isClockedInElsewhere =
    activeEntryId && activeEntryProjectId !== projectId;

  useEffect(() => {
    if (!isClockedInHere || !activeClockIn) return;
    const start = new Date(activeClockIn).getTime();
    const update = () => {
      const ms = Date.now() - start;
      setElapsed(formatElapsed(ms));
      if (hourlyRate > 0) {
        setLiveEarnings((ms / 3600000) * hourlyRate);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isClockedInHere, activeClockIn, hourlyRate]);

  async function getLocation(): Promise<{
    lat?: number;
    lng?: number;
  }> {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 5000,
        })
      );
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return {};
    }
  }

  async function handleClockIn() {
    setLoading(true);
    try {
      const { lat, lng } = await getLocation();
      const result = await clockIn(employeeId, projectId, lat, lng);
      if (result.error) {
        alert(result.error);
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleClockOut() {
    if (!activeEntryId) return;
    setLoading(true);
    try {
      const { lat, lng } = await getLocation();
      await clockOut(activeEntryId, lat, lng);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (isClockedInElsewhere) {
    return (
      <Button disabled className="w-full h-14 text-lg opacity-50">
        Clocked in at another project
      </Button>
    );
  }

  if (isClockedInHere) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-around rounded-lg border border-border/50 bg-card p-4">
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">Time on site</p>
            <p className="text-2xl font-mono font-bold text-amber-500">
              {elapsed}
            </p>
          </div>
          {hourlyRate > 0 && (
            <div className="text-center border-l border-border/50 pl-6">
              <div className="flex items-center justify-center gap-1 mb-1">
                <DollarSign className="h-3 w-3 text-green-500" />
                <p className="text-xs text-muted-foreground">Earning</p>
              </div>
              <p className="text-2xl font-mono font-bold text-green-500">
                ${liveEarnings.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                ${hourlyRate.toFixed(0)}/hr
              </p>
            </div>
          )}
        </div>
        <Button
          onClick={handleClockOut}
          disabled={loading}
          className="w-full h-14 text-lg bg-red-600 hover:bg-red-700 text-white"
        >
          <Clock className="h-5 w-5 mr-2" />
          {loading ? "Clocking Out..." : "Clock Out"}
        </Button>
      </div>
    );
  }

  return (
    <Button
      onClick={handleClockIn}
      disabled={loading}
      className="w-full h-14 text-lg bg-green-600 hover:bg-green-700 text-white"
    >
      <Clock className="h-5 w-5 mr-2" />
      {loading ? "Clocking In..." : "Clock In"}
    </Button>
  );
}
