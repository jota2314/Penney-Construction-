"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function inviteFieldWorker(
  email: string,
  firstName: string,
  lastName: string,
  title?: string,
  hourlyRate?: number
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const normalizedEmail = email.toLowerCase().trim();

  // Add to allowed_emails
  const { error: emailErr } = await supabase.from("allowed_emails").upsert(
    { email: normalizedEmail, role: "field", invited_by: user.id },
    { onConflict: "email" }
  );
  if (emailErr) return { error: emailErr.message };

  // If this person already has a profile (existing account), update their role
  // and link their employee record to their profile
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", normalizedEmail)
    .single();

  if (existingProfile) {
    await supabase
      .from("profiles")
      .update({ role: "field" })
      .eq("id", existingProfile.id);

    // Auto-link employee to profile
    await supabase
      .from("employees")
      .update({ profile_id: existingProfile.id })
      .eq("email", normalizedEmail)
      .is("profile_id", null);
  }

  // Create or update employee record
  const { data: existingEmployee } = await supabase
    .from("employees")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .single();

  if (existingEmployee) {
    await supabase
      .from("employees")
      .update({
        first_name: firstName,
        last_name: lastName,
        title: title || null,
        hourly_rate: hourlyRate || null,
        status: "active",
      })
      .eq("id", existingEmployee.id);
  } else {
    await supabase.from("employees").insert({
      first_name: firstName,
      last_name: lastName,
      email: email.toLowerCase().trim(),
      title: title || null,
      hourly_rate: hourlyRate || null,
      status: "active",
      created_by: user.id,
    });
  }

  revalidatePath("/crew-admin");
  return { success: true };
}

export async function assignProjectToCrew(
  employeeId: string,
  projectId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("crew_project_assignments").upsert(
    {
      employee_id: employeeId,
      project_id: projectId,
      assigned_by: user.id,
    },
    { onConflict: "employee_id,project_id" }
  );

  if (error) return { error: error.message };

  revalidatePath("/crew-admin");
  return { success: true };
}

export async function unassignProjectFromCrew(
  employeeId: string,
  projectId: string
) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("crew_project_assignments")
    .delete()
    .eq("employee_id", employeeId)
    .eq("project_id", projectId);

  if (error) return { error: error.message };

  revalidatePath("/crew-admin");
  return { success: true };
}

export async function getCrewAdminData() {
  const supabase = await createClient();

  // Get all field employees (with or without profile link)
  const { data: employees } = await supabase
    .from("employees")
    .select("*")
    .eq("status", "active")
    .order("first_name");

  // Get allowed field emails
  const { data: allowedEmails } = await supabase
    .from("allowed_emails")
    .select("*")
    .eq("role", "field")
    .order("created_at", { ascending: false });

  // Get all active time entries (currently clocked in)
  const { data: activeEntries } = await supabase
    .from("time_entries")
    .select(
      "*, employees:employee_id(first_name, last_name, hourly_rate), projects:project_id(name, project_number)"
    )
    .is("clock_out", null);

  // Get today's completed entries
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: todayEntries } = await supabase
    .from("time_entries")
    .select(
      "*, employees:employee_id(first_name, last_name, hourly_rate), projects:project_id(name, project_number)"
    )
    .gte("clock_in", todayStart.toISOString())
    .order("clock_in", { ascending: false });

  // Get all crew project assignments
  const { data: assignments } = await supabase
    .from("crew_project_assignments")
    .select(
      "*, employees:employee_id(first_name, last_name), projects:project_id(name, project_number)"
    );

  // Get active projects for assignment dropdown
  const { data: activeProjects } = await supabase
    .from("projects")
    .select("id, name, project_number")
    .in("status", ["contracted", "in_progress"])
    .order("name");

  return {
    employees: employees ?? [],
    allowedEmails: allowedEmails ?? [],
    activeEntries: activeEntries ?? [],
    todayEntries: todayEntries ?? [],
    assignments: assignments ?? [],
    activeProjects: activeProjects ?? [],
  };
}

export async function getCrewHubMetrics() {
  const supabase = await createClient();

  // Count active clocked-in workers
  const { count: clockedIn } = await supabase
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .is("clock_out", null);

  // Total hours today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: todayEntries } = await supabase
    .from("time_entries")
    .select("clock_in, clock_out, break_minutes")
    .gte("clock_in", todayStart.toISOString());

  let totalMinutesToday = 0;
  for (const e of todayEntries ?? []) {
    const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
    const ms = end - new Date(e.clock_in).getTime();
    totalMinutesToday += Math.floor(ms / 60000) - (e.break_minutes || 0);
  }

  // Count field workers
  const { count: fieldWorkers } = await supabase
    .from("allowed_emails")
    .select("id", { count: "exact", head: true })
    .eq("role", "field");

  return {
    clockedIn: clockedIn ?? 0,
    hoursToday: Math.round(totalMinutesToday / 60 * 10) / 10,
    fieldWorkers: fieldWorkers ?? 0,
  };
}
