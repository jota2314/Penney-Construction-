"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchTimeEntriesCompat } from "@/lib/crew/time-entries-compat";
import { distanceMeters, GEOFENCE_METERS } from "@/lib/crew/geo";
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

export type LiveCrewPosition = {
  daily_log_id: string;
  profile_id: string;
  name: string;
  project_id: string | null;
  project_name: string | null;
  lat: number;
  lng: number;
  /** Metres from the jobsite pin; null when there's no jobsite to measure to. */
  distance_m: number | null;
  /** null means unknown — no jobsite on the log, not "on site". */
  on_site: boolean | null;
  captured_at: string;
  /** true = live ping, false = the clock-in fix (they never pinged). */
  is_ping: boolean;
};

/**
 * Where the clocked-in crew actually are, from `daily_log_pings` — as opposed
 * to `LiveMapData.pins`, which shows the jobsite they claim to be on. The two
 * disagreeing is the point: a worker clocked into a job but sitting a few km
 * away is exactly what this surfaces.
 *
 * Falls back to the clock-in fix when a phone hasn't pinged yet. Anyone
 * clocked in with no location at all is omitted — there's nothing to plot.
 */
export async function getLiveCrewPositions(): Promise<LiveCrewPosition[]> {
  const supabase = await createClient();

  const { data: logs } = await supabase
    .from("daily_logs")
    .select(
      `
      id, author_id, project_id, started_at,
      clock_in_lat, clock_in_lng, clock_in_distance_m, clock_in_on_site,
      projects:project_id(name, latitude, longitude),
      profiles:author_id(full_name)
    `,
    )
    .eq("status", "in_progress")
    .order("started_at", { ascending: false });

  if (!logs || logs.length === 0) return [];

  const { data: pings } = await supabase
    .from("daily_log_pings")
    .select("daily_log_id, lat, lng, distance_m, on_site, captured_at")
    .in(
      "daily_log_id",
      logs.map((l) => l.id),
    )
    .order("captured_at", { ascending: false });

  // Newest-first, so the first row seen per log is that log's latest fix.
  const latestPing = new Map<string, NonNullable<typeof pings>[number]>();
  for (const p of pings ?? []) {
    if (!latestPing.has(p.daily_log_id)) latestPing.set(p.daily_log_id, p);
  }

  const out: LiveCrewPosition[] = [];
  for (const log of logs) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const project = Array.isArray((log as any).projects)
      ? (log as any).projects[0]
      : (log as any).projects;
    const profile = Array.isArray((log as any).profiles)
      ? (log as any).profiles[0]
      : (log as any).profiles;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const ping = latestPing.get(log.id);

    const lat = ping?.lat ?? log.clock_in_lat;
    const lng = ping?.lng ?? log.clock_in_lng;
    if (lat == null || lng == null) continue;

    // Prefer the stored distance; otherwise derive it, so a ping that predates
    // the geofence columns still says whether they drifted off site.
    let distance = ping ? ping.distance_m : log.clock_in_distance_m;
    if (distance == null && project?.latitude != null && project?.longitude != null) {
      distance = distanceMeters(
        Number(lat),
        Number(lng),
        Number(project.latitude),
        Number(project.longitude),
      );
    }
    let onSite = ping ? ping.on_site : log.clock_in_on_site;
    if (onSite == null && distance != null) onSite = distance <= GEOFENCE_METERS;

    out.push({
      daily_log_id: log.id,
      profile_id: log.author_id,
      name: profile?.full_name ?? "Unknown",
      project_id: log.project_id ?? null,
      project_name: project?.name ?? null,
      lat: Number(lat),
      lng: Number(lng),
      distance_m: distance == null ? null : Number(distance),
      on_site: onSite,
      captured_at: ping?.captured_at ?? log.started_at,
      is_ping: !!ping,
    });
  }

  return out;
}
