"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";

export async function getCrewEmployee() {
  const supabase = await createClient();
  const user = await getUser();
  const profileId = user?.profile?.id;
  if (!profileId) return null;

  const { data: employee } = await supabase
    .from("employees")
    .select("*")
    .eq("profile_id", profileId)
    .single();

  return employee;
}

export async function getCrewDashboardData() {
  const supabase = await createClient();
  const user = await getUser();
  const profileId = user?.profile?.id;
  if (!profileId) return null;

  // Get the employee record linked to this profile
  const { data: employee } = await supabase
    .from("employees")
    .select("*")
    .eq("profile_id", profileId)
    .single();

  if (!employee) return { employee: null, projects: [], activeEntry: null };

  // Get assigned projects
  const { data: assignments } = await supabase
    .from("crew_project_assignments")
    .select("project_id")
    .eq("employee_id", employee.id);

  const projectIds = (assignments ?? []).map((a) => a.project_id);

  let projects: {
    id: string;
    name: string;
    project_number: string;
    address: string | null;
    city: string | null;
    state: string | null;
    status: string;
    latitude: number | null;
    longitude: number | null;
  }[] = [];

  if (projectIds.length > 0) {
    const { data } = await supabase
      .from("projects")
      .select(
        "id, name, project_number, address, city, state, status, latitude, longitude"
      )
      .in("id", projectIds)
      .in("status", ["contracted", "in_progress"])
      .order("name");
    projects = data ?? [];
  }

  // Get active clock entry
  const { data: activeEntry } = await supabase
    .from("time_entries")
    .select("*, projects:project_id(name, project_number)")
    .eq("employee_id", employee.id)
    .is("clock_out", null)
    .single();

  return { employee, projects, activeEntry };
}

export async function getCrewProjectDetail(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: employee } = await supabase
    .from("employees")
    .select("id, hourly_rate")
    .eq("profile_id", user.id)
    .single();

  if (!employee) return null;

  // Fetch project
  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, project_number, address, city, state, zip, status, project_type, description, latitude, longitude"
    )
    .eq("id", projectId)
    .single();

  if (!project) return null;

  // Fetch recent time entries for this employee on this project (last 14 days)
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const { data: timeEntries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("employee_id", employee.id)
    .eq("project_id", projectId)
    .gte("clock_in", twoWeeksAgo.toISOString())
    .order("clock_in", { ascending: false });

  // Get active clock entry
  const { data: activeEntry } = await supabase
    .from("time_entries")
    .select("*")
    .eq("employee_id", employee.id)
    .is("clock_out", null)
    .single();

  return {
    project,
    employee,
    timeEntries: timeEntries ?? [],
    activeEntry,
  };
}

function calcEarnedCents(
  entries: { clock_in: string; clock_out: string | null; break_minutes: number }[],
  hourlyRate: number
): number {
  let cents = 0;
  for (const e of entries) {
    if (!e.clock_out) continue;
    const ms = new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime();
    const hours = ms / 3600000 - (e.break_minutes || 0) / 60;
    cents += Math.round(hours * hourlyRate * 100);
  }
  return cents;
}

export async function getCrewEarnings() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: employee } = await supabase
    .from("employees")
    .select("id, hourly_rate")
    .eq("profile_id", user.id)
    .single();

  if (!employee || !employee.hourly_rate) return null;

  const rate = employee.hourly_rate;

  // Today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // This week (Sunday start)
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  // Pay period — biweekly, using a known epoch (Jan 1 2024 was a Monday)
  const periodEpoch = new Date("2024-01-01T00:00:00");
  const daysSinceEpoch = Math.floor(
    (Date.now() - periodEpoch.getTime()) / 86400000
  );
  const daysIntoPeriod = daysSinceEpoch % 14;
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - daysIntoPeriod);
  periodStart.setHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + 13);

  // Fetch all entries from period start (covers today + week + period)
  const { data: entries } = await supabase
    .from("time_entries")
    .select("clock_in, clock_out, break_minutes")
    .eq("employee_id", employee.id)
    .gte("clock_in", periodStart.toISOString())
    .not("clock_out", "is", null);

  const allEntries = entries ?? [];

  const todayEntries = allEntries.filter(
    (e) => new Date(e.clock_in) >= todayStart
  );
  const weekEntries = allEntries.filter(
    (e) => new Date(e.clock_in) >= weekStart
  );

  // Active clock
  const { data: activeEntry } = await supabase
    .from("time_entries")
    .select("clock_in")
    .eq("employee_id", employee.id)
    .is("clock_out", null)
    .single();

  // Format period label
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const periodLabel = `Pay Period (${fmt(periodStart)} – ${fmt(periodEnd)})`;

  return {
    hourlyRate: rate,
    clockInTime: activeEntry?.clock_in ?? null,
    todayEarnedCents: calcEarnedCents(todayEntries, rate),
    weekEarnedCents: calcEarnedCents(weekEntries, rate),
    periodEarnedCents: calcEarnedCents(allEntries, rate),
    periodLabel,
  };
}
