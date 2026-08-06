"use client";

import { useEffect, useState } from "react";
import { Activity, HeartPulse, Moon, Flame, Dumbbell, Loader2 } from "lucide-react";

interface RecoveryRecord {
  cycle_id: number;
  created_at: string;
  score_state: string;
  score?: {
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
}

interface CycleRecord {
  id: number;
  start: string;
  end?: string;
  score_state: string;
  score?: { strain: number; kilojoule: number; average_heart_rate: number; max_heart_rate: number };
}

interface SleepRecord {
  id: string;
  start: string;
  end: string;
  nap: boolean;
  score_state: string;
  score?: {
    sleep_performance_percentage?: number;
    sleep_efficiency_percentage?: number;
    respiratory_rate?: number;
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      disturbance_count: number;
    };
  };
}

interface WorkoutRecord {
  id: string;
  sport_name: string;
  start: string;
  end: string;
  score_state: string;
  score?: { strain: number; kilojoule: number; average_heart_rate: number; max_heart_rate: number };
}

interface WhoopData {
  connected: boolean;
  recoveries?: RecoveryRecord[];
  cycles?: CycleRecord[];
  sleeps?: SleepRecord[];
  workouts?: WorkoutRecord[];
}

function recoveryColor(score: number) {
  if (score >= 67) return "text-green-500";
  if (score >= 34) return "text-yellow-500";
  return "text-red-500";
}

function recoveryBg(score: number) {
  if (score >= 67) return "bg-green-500";
  if (score >= 34) return "bg-yellow-500";
  return "bg-red-500";
}

function formatDuration(milli: number) {
  const totalMin = Math.round(milli / 60000);
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function kJToCal(kj: number) {
  return Math.round(kj / 4.184);
}

export function WhoopDashboard() {
  const [data, setData] = useState<WhoopData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/whoop/data")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ connected: false }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading WHOOP data…
      </div>
    );
  }

  if (!data?.connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <Activity className="h-12 w-12 text-amber-500" />
        <div>
          <p className="text-lg font-semibold">Connect your WHOOP</p>
          <p className="text-sm text-muted-foreground mt-1">
            Recovery, sleep, and strain right in the Command Center.
          </p>
        </div>
        <a
          href="/api/whoop/callback"
          className="rounded-md bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700"
        >
          Connect WHOOP
        </a>
      </div>
    );
  }

  const latestRecovery = data.recoveries?.find((r) => r.score_state === "SCORED");
  const latestSleep = data.sleeps?.find((s) => s.score_state === "SCORED" && !s.nap);
  const todayCycle = data.cycles?.[0];
  const trend = [...(data.recoveries ?? [])].reverse();

  const stages = latestSleep?.score?.stage_summary;
  const asleepMilli = stages
    ? stages.total_light_sleep_time_milli + stages.total_slow_wave_sleep_time_milli + stages.total_rem_sleep_time_milli
    : 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Recovery */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <HeartPulse className="h-4 w-4 text-amber-500" /> Recovery
          </div>
          {latestRecovery?.score ? (
            <>
              <p className={`mt-2 text-4xl font-bold ${recoveryColor(latestRecovery.score.recovery_score)}`}>
                {Math.round(latestRecovery.score.recovery_score)}%
              </p>
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                <p>HRV: <span className="text-foreground font-medium">{Math.round(latestRecovery.score.hrv_rmssd_milli)} ms</span></p>
                <p>Resting HR: <span className="text-foreground font-medium">{Math.round(latestRecovery.score.resting_heart_rate)} bpm</span></p>
                {latestRecovery.score.spo2_percentage != null && (
                  <p>SpO2: <span className="text-foreground font-medium">{latestRecovery.score.spo2_percentage.toFixed(1)}%</span></p>
                )}
              </div>
            </>
          ) : (
            <p className="mt-2 text-muted-foreground text-sm">No scored recovery yet</p>
          )}
        </div>

        {/* Sleep */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Moon className="h-4 w-4 text-amber-500" /> Last Sleep
          </div>
          {latestSleep?.score && stages ? (
            <>
              <p className="mt-2 text-4xl font-bold">
                {latestSleep.score.sleep_performance_percentage != null
                  ? `${Math.round(latestSleep.score.sleep_performance_percentage)}%`
                  : formatDuration(asleepMilli)}
              </p>
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                <p>Asleep: <span className="text-foreground font-medium">{formatDuration(asleepMilli)}</span></p>
                <p>In bed: <span className="text-foreground font-medium">{formatDuration(stages.total_in_bed_time_milli)}</span></p>
                <p>Disturbances: <span className="text-foreground font-medium">{stages.disturbance_count}</span></p>
              </div>
              {/* Stage bar */}
              <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full">
                <div className="bg-sky-400" style={{ width: `${(stages.total_light_sleep_time_milli / stages.total_in_bed_time_milli) * 100}%` }} />
                <div className="bg-indigo-500" style={{ width: `${(stages.total_slow_wave_sleep_time_milli / stages.total_in_bed_time_milli) * 100}%` }} />
                <div className="bg-purple-500" style={{ width: `${(stages.total_rem_sleep_time_milli / stages.total_in_bed_time_milli) * 100}%` }} />
                <div className="bg-muted" style={{ width: `${(stages.total_awake_time_milli / stages.total_in_bed_time_milli) * 100}%` }} />
              </div>
              <div className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground">
                <span><span className="inline-block h-2 w-2 rounded-full bg-sky-400 mr-1" />Light</span>
                <span><span className="inline-block h-2 w-2 rounded-full bg-indigo-500 mr-1" />Deep</span>
                <span><span className="inline-block h-2 w-2 rounded-full bg-purple-500 mr-1" />REM</span>
                <span><span className="inline-block h-2 w-2 rounded-full bg-muted mr-1" />Awake</span>
              </div>
            </>
          ) : (
            <p className="mt-2 text-muted-foreground text-sm">No scored sleep yet</p>
          )}
        </div>

        {/* Strain */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Flame className="h-4 w-4 text-amber-500" /> Day Strain
          </div>
          {todayCycle?.score ? (
            <>
              <p className="mt-2 text-4xl font-bold text-amber-500">{todayCycle.score.strain.toFixed(1)}</p>
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                <p>Calories: <span className="text-foreground font-medium">{kJToCal(todayCycle.score.kilojoule).toLocaleString()} cal</span></p>
                <p>Avg HR: <span className="text-foreground font-medium">{todayCycle.score.average_heart_rate} bpm</span></p>
                <p>Max HR: <span className="text-foreground font-medium">{todayCycle.score.max_heart_rate} bpm</span></p>
              </div>
            </>
          ) : (
            <p className="mt-2 text-muted-foreground text-sm">Cycle still scoring…</p>
          )}
        </div>
      </div>

      {/* Recovery trend */}
      {trend.length > 1 && (
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <Activity className="h-4 w-4 text-amber-500" /> Recovery — last {trend.length} days
          </div>
          <div className="flex items-end gap-2 h-28">
            {trend.map((r, i) =>
              r.score ? (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-muted-foreground">{Math.round(r.score.recovery_score)}</span>
                  <div
                    className={`w-full rounded-t ${recoveryBg(r.score.recovery_score)}`}
                    style={{ height: `${Math.max(r.score.recovery_score, 4)}%` }}
                  />
                </div>
              ) : (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-muted-foreground">—</span>
                  <div className="w-full rounded-t bg-muted" style={{ height: "4%" }} />
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Recent workouts */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
          <Dumbbell className="h-4 w-4 text-amber-500" /> Recent Workouts
        </div>
        {data.workouts?.length ? (
          <div className="divide-y">
            {data.workouts.map((w) => (
              <div key={w.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium capitalize">{w.sport_name?.replace(/_/g, " ") || "Activity"}</p>
                  <p className="text-xs text-muted-foreground">{formatDay(w.start)}</p>
                </div>
                {w.score ? (
                  <div className="text-right text-sm">
                    <p className="font-semibold text-amber-500">{w.score.strain.toFixed(1)} strain</p>
                    <p className="text-xs text-muted-foreground">
                      {kJToCal(w.score.kilojoule).toLocaleString()} cal · avg {w.score.average_heart_rate} bpm
                    </p>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">scoring…</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No workouts recorded yet.</p>
        )}
      </div>
    </div>
  );
}
