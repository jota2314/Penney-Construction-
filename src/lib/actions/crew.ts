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
    .select("id")
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
