"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function clockIn(
  employeeId: string,
  projectId: string,
  lat?: number,
  lng?: number
) {
  const supabase = await createClient();

  // Check for existing open entry
  const { data: existing } = await supabase
    .from("time_entries")
    .select("id")
    .eq("employee_id", employeeId)
    .is("clock_out", null)
    .single();

  if (existing) {
    return { error: "Already clocked in. Clock out first." };
  }

  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      employee_id: employeeId,
      project_id: projectId,
      clock_in: new Date().toISOString(),
      clock_in_lat: lat ?? null,
      clock_in_lng: lng ?? null,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/crew");
  revalidatePath(`/crew/project/${projectId}`);
  return { data };
}

export async function clockOut(
  timeEntryId: string,
  lat?: number,
  lng?: number,
  breakMinutes?: number
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("time_entries")
    .update({
      clock_out: new Date().toISOString(),
      clock_out_lat: lat ?? null,
      clock_out_lng: lng ?? null,
      break_minutes: breakMinutes ?? 0,
    })
    .eq("id", timeEntryId)
    .select()
    .single();

  if (error) return { error: error.message };

  revalidatePath("/crew");
  revalidatePath(`/crew/project/${data.project_id}`);
  revalidatePath("/crew/time-log");
  return { data };
}

export async function getActiveClockEntry(employeeId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("time_entries")
    .select("*, projects:project_id(name, project_number)")
    .eq("employee_id", employeeId)
    .is("clock_out", null)
    .single();

  return data;
}

export async function getTimeEntries(
  employeeId: string,
  startDate: string,
  endDate: string
) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("time_entries")
    .select("*, projects:project_id(name, project_number)")
    .eq("employee_id", employeeId)
    .gte("clock_in", startDate)
    .lte("clock_in", endDate)
    .order("clock_in", { ascending: false });

  return data ?? [];
}
