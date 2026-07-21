"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchTimeEntriesCompat } from "@/lib/crew/time-entries-compat";
import {
  getRateVisibility,
  maskTimeEntryRates,
} from "@/lib/auth/rate-visibility";
import type { FeedLiveShift } from "@/components/field-feed/command-center-feed";
import type { MapPin } from "@/components/field-feed/map-view";

export type LiveMapData = {
  pins: MapPin[];
  activeShifts: FeedLiveShift[];
  completedTodayCents: number;
  missingCoordsCount: number;
};

function startOfTodayET(): Date {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  now.setHours(0, 0, 0, 0);
  return now;
}

/**
 * Data for the /command-center/map page: every active jobsite as a map pin
 * (with who's on the clock there), plus the shifts that drive the
 * spending-by-the-second banner. Finished shifts today are a fixed cost;
 * open shifts are returned raw so the client can tick their cost live.
 */
export async function getLiveMapData(): Promise<LiveMapData> {
  const supabase = await createClient();

  const [projectsRes, openShifts, todayClosedShifts] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_number, name, address, city, latitude, longitude")
      .in("status", ["in_progress", "contracted"])
      .order("updated_at", { ascending: false })
      .limit(50),
    fetchTimeEntriesCompat(supabase, { open: true }).catch(() => []),
    fetchTimeEntriesCompat(supabase, {
      open: false,
      since: startOfTodayET().toISOString(),
    }).catch(() => []),
  ]);

  type Row = {
    id: string;
    project_number: string;
    name: string;
    address: string | null;
    city: string | null;
    // Supabase returns numeric columns as strings — coerce before use.
    latitude: number | string | null;
    longitude: number | string | null;
  };
  const projects = (projectsRes.data ?? []) as Row[];

  const toCoord = (x: number | string | null): number | null => {
    if (x == null) return null;
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) ? n : null;
  };

  const crewByProject = new Map<string, string[]>();
  for (const shift of openShifts) {
    if (!shift.project_id) continue;
    const name = shift.employees
      ? `${shift.employees.first_name} ${shift.employees.last_name}`
      : "Unknown";
    const list = crewByProject.get(shift.project_id) ?? [];
    list.push(name);
    crewByProject.set(shift.project_id, list);
  }

  const pins: MapPin[] = projects.flatMap((p) => {
    const lat = toCoord(p.latitude);
    const lng = toCoord(p.longitude);
    if (lat == null || lng == null) return [];
    return [{
      project_id: p.id,
      project_name: p.name,
      project_number: p.project_number,
      lat,
      lng,
      address: [p.address, p.city].filter(Boolean).join(", ") || null,
      liveCrew: crewByProject.get(p.id) ?? [],
    }];
  });

  let completedTodayCents = 0;
  for (const entry of todayClosedShifts) {
    if (!entry.clock_out) continue;
    const ms =
      new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime();
    if (ms <= 0) continue;
    const rate = entry.employees?.hourly_rate ?? 0;
    completedTodayCents += Math.round((ms / 3_600_000) * rate * 100);
  }

  // Per-shift rates are masked for viewers outside the office-rate set
  // (aggregate completedTodayCents above stays true).
  const vis = await getRateVisibility();
  const activeShifts: FeedLiveShift[] = maskTimeEntryRates(vis, openShifts).map(
    (entry) => ({
      id: entry.id,
      name: entry.employees
        ? `${entry.employees.first_name} ${entry.employees.last_name}`
        : "Unknown",
      clockIn: entry.clock_in,
      rateCentsPerHour: Math.round((entry.employees?.hourly_rate ?? 0) * 100),
      projectName: entry.projects?.name ?? null,
    }),
  );

  return {
    pins,
    activeShifts,
    completedTodayCents,
    missingCoordsCount: projects.length - pins.length,
  };
}
