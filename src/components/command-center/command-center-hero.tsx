"use client";

import { FolderKanban, Bell, Mail, RefreshCw, Loader2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface CommandCenterHeroProps {
  dayName: string;
  dateStr: string;
  projectCount: number;
  todoCount: number;
  emailCount: number;
}

export function CommandCenterHero({
  dayName,
  dateStr,
  projectCount,
  todoCount,
  emailCount,
}: CommandCenterHeroProps) {
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

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-600/20 via-amber-700/10 to-transparent border border-amber-500/20 p-5">
      {/* Background accent */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />

      <div className="relative">
        {/* Greeting + date */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {getGreeting()}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {dayName} &middot; {dateStr}
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={fetching}
            className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50 bg-amber-500/10 rounded-full px-3 py-1.5"
          >
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {fetching ? "Syncing..." : "Sync"}
          </button>
        </div>

        {/* Quick stats row */}
        <div className="flex gap-4 mt-4">
          <QuickStat icon={FolderKanban} value={projectCount} label="Projects" />
          <QuickStat icon={Bell} value={todoCount} label="Todos" />
          <QuickStat icon={Mail} value={emailCount} label="Emails" />
        </div>
      </div>
    </div>
  );
}

function QuickStat({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-amber-500/70" />
      <div>
        <span className="text-lg font-bold">{value}</span>
        <span className="text-xs text-muted-foreground ml-1">{label}</span>
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
