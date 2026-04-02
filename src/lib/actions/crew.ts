"use server";

import { createClient } from "@/lib/supabase/server";

export async function getCrewEmployee() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: employee } = await supabase
    .from("employees")
    .select("*")
    .eq("profile_id", user.id)
    .single();

  return employee;
}

export async function getCrewDashboardData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Get the employee record linked to this profile
  const { data: employee } = await supabase
    .from("employees")
    .select("*")
    .eq("profile_id", user.id)
    .single();

  if (!employee) return { employee: null, projects: [], activeEntry: null, todayEarnedCents: 0 };

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

  // Get today's completed time entries to calculate earnings so far
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: todayEntries } = await supabase
    .from("time_entries")
    .select("clock_in, clock_out, break_minutes")
    .eq("employee_id", employee.id)
    .gte("clock_in", todayStart.toISOString())
    .not("clock_out", "is", null);

  // Calculate today's completed earnings in cents
  const hourlyRate = employee.hourly_rate || 0;
  let todayEarnedCents = 0;
  if (todayEntries && hourlyRate > 0) {
    for (const entry of todayEntries) {
      const ms = new Date(entry.clock_out!).getTime() - new Date(entry.clock_in).getTime();
      const hours = (ms / 3600000) - ((entry.break_minutes || 0) / 60);
      todayEarnedCents += Math.round(hours * hourlyRate * 100);
    }
  }

  return { employee, projects, activeEntry, todayEarnedCents };
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
