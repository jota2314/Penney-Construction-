"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createScheduledEvent, deleteEvent } from "@/lib/google/calendar";

interface SchedulePhaseInput {
  project_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  status?: string;
  sort_order?: number;
  assigned_employee_ids?: string[];
  assigned_sub_ids?: string[];
  color?: string;
  notes?: string;
}

export async function createSchedulePhase(input: SchedulePhaseInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("schedule_phases").insert({
    project_id: input.project_id,
    name: input.name,
    description: input.description || null,
    start_date: input.start_date,
    end_date: input.end_date,
    status: input.status || "not_started",
    sort_order: input.sort_order ?? 0,
    assigned_employee_ids: input.assigned_employee_ids ?? [],
    assigned_sub_ids: input.assigned_sub_ids ?? [],
    color: input.color || "#3b82f6",
    notes: input.notes || null,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${input.project_id}`);
  revalidatePath("/schedule");
  return { error: null };
}

export async function updateSchedulePhase(
  id: string,
  input: SchedulePhaseInput
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("schedule_phases")
    .update({
      name: input.name,
      description: input.description || null,
      start_date: input.start_date,
      end_date: input.end_date,
      status: input.status || "not_started",
      sort_order: input.sort_order ?? 0,
      assigned_employee_ids: input.assigned_employee_ids ?? [],
      assigned_sub_ids: input.assigned_sub_ids ?? [],
      color: input.color || "#3b82f6",
      notes: input.notes || null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${input.project_id}`);
  revalidatePath("/schedule");
  return { error: null };
}

export async function deleteSchedulePhase(id: string, projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Pull the Google Calendar event ID before we delete the row so we can
  // cancel the event too — otherwise attendees keep getting reminders for
  // a phase that no longer exists in our system.
  const { data: phase } = await supabase
    .from("schedule_phases")
    .select("google_calendar_event_id")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("schedule_phases")
    .delete()
    .eq("id", id);

  if (error) return { error: error.message };

  if (phase?.google_calendar_event_id) {
    try {
      await deleteEvent(phase.google_calendar_event_id);
    } catch {
      // Non-fatal — Google may be unreachable or token expired. The phase
      // is already gone from our DB; user can clean up the event manually.
    }
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/schedule");
  return { error: null };
}

/**
 * Sync a schedule phase to Google Calendar. Creates a calendar event
 * and stores the event ID back on the phase.
 */
export async function syncToGoogleCalendar(phaseId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: phase } = await supabase
    .from("schedule_phases")
    .select("*")
    .eq("id", phaseId)
    .single();

  if (!phase) return { error: "Phase not found" };
  if (phase.google_calendar_event_id) return { error: "Already synced to Google Calendar" };

  try {
    const calEvent = await createScheduledEvent({
      name: phase.name,
      description: phase.description || undefined,
      location: phase.notes?.match(/Location: (.+)/)?.[1] || undefined,
      startTime: `${phase.start_date}T09:00:00-04:00`,
      endTime: `${phase.end_date}T10:00:00-04:00`,
      withMeetLink: false,
    });

    await supabase
      .from("schedule_phases")
      .update({
        google_calendar_event_id: calEvent.id,
      })
      .eq("id", phaseId);

    revalidatePath("/schedule");
    return { error: null, calendarLink: calEvent.htmlLink };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to sync" };
  }
}

/**
 * Add a Google Meet link to an existing schedule phase.
 * If already synced to Calendar, creates a new event with Meet; otherwise creates both.
 */
export async function addGoogleMeet(phaseId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: phase } = await supabase
    .from("schedule_phases")
    .select("*")
    .eq("id", phaseId)
    .single();

  if (!phase) return { error: "Phase not found" };
  if (phase.google_meet_link) return { error: "Already has a Google Meet link" };

  try {
    const calEvent = await createScheduledEvent({
      name: phase.name,
      description: phase.description || undefined,
      startTime: `${phase.start_date}T09:00:00-04:00`,
      endTime: `${phase.end_date}T10:00:00-04:00`,
      withMeetLink: true,
    });

    const meetLink = calEvent.hangoutLink ||
      calEvent.conferenceData?.entryPoints?.find(e => e.entryPointType === "video")?.uri ||
      null;

    await supabase
      .from("schedule_phases")
      .update({
        google_calendar_event_id: calEvent.id,
        google_meet_link: meetLink,
      })
      .eq("id", phaseId);

    revalidatePath("/schedule");
    return { error: null, meetLink };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create Meet" };
  }
}
