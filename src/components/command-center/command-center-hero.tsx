"use client";

import { RefreshCw, Loader2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import type { WeatherData } from "@/lib/actions/weather";

interface CommandCenterHeaderProps {
  dateStr: string;
  weather: WeatherData | null;
}

export function CommandCenterHeader({ dateStr, weather }: CommandCenterHeaderProps) {
  const [fetching, setFetching] = useState(false);
  const router = useRouter();

  async function handleSync() {
    setFetching(true);
    try {
      const res = await fetch("/api/fetch-and-store-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      router.refresh();
    } catch {
      // silently fail
    } finally {
      setFetching(false);
    }
  }

  const greeting = getGreeting();

  return (
    <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-border/30">
      {/* Top row: date + actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{dateStr}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={fetching}
            className="flex items-center justify-center h-9 w-9 rounded-full border border-border/50 text-muted-foreground hover:text-amber-500 hover:border-amber-500/30 transition-colors disabled:opacity-50"
          >
            {fetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
          <ThemeToggle />
        </div>
      </div>

      {/* Greeting + weather */}
      <div className="mt-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting}, Jorge
          {weather && (
            <span className="ml-2 text-lg font-normal">
              {weather.emoji} {weather.temp}°
            </span>
          )}
        </h1>

        {/* Weather motivation */}
        {weather && (
          <p className="text-sm text-amber-500/80 mt-1 italic">
            {weather.motivation}
          </p>
        )}
      </div>
    </header>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
