"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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

const schedulePhaseInputSchema = z
  .object({
    project_id: z.string().uuid("Choose a valid project."),
    name: z.string().trim().min(1, "Schedule item is required.").max(120),
    description: z.string().trim().max(500).optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid start date."),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid end date."),
    status: z
      .enum(["not_started", "in_progress", "completed", "on_hold"])
      .optional(),
    sort_order: z.number().int().min(0).optional(),
    assigned_employee_ids: z.array(z.string().uuid()).max(100).optional(),
    assigned_sub_ids: z.array(z.string().uuid()).max(100).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((input) => input.end_date >= input.start_date, {
    message: "End date must be on or after the start date.",
    path: ["end_date"],
  });

export async function createSchedulePhase(input: SchedulePhaseInput) {
  const parsed = schedulePhaseInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Check the schedule details.",
    };
  }
  const validated = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("schedule_phases").insert({
    project_id: validated.project_id,
    name: validated.name,
    description: validated.description || null,
    start_date: validated.start_date,
    end_date: validated.end_date,
    planned_start_date: validated.start_date,
    planned_end_date: validated.end_date,
    status: validated.status || "not_started",
    sort_order: validated.sort_order ?? 0,
    assigned_employee_ids: validated.assigned_employee_ids ?? [],
    assigned_sub_ids: validated.assigned_sub_ids ?? [],
    color: validated.color || "#3b82f6",
    notes: validated.notes || null,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${validated.project_id}`);
  revalidatePath("/schedule");
  revalidatePath("/command-center");
  return { error: null };
}

/**
 * Active crew + subs for the "Add work" form on the schedule click panel.
 * Lazy-loaded the first time a user opens the Add-phase dialog from the
 * Command Center / schedule strip (those entry points don't have the lists
 * server-rendered the way the project detail page does).
 */
export async function getPhaseFormOptions() {
  const supabase = await createClient();
  const [{ data: employees }, { data: subcontractors }] = await Promise.all([
    supabase
      .from("employees")
      .select("*")
      .eq("status", "active")
      .order("first_name", { ascending: true }),
    supabase
      .from("subcontractors")
      .select("*")
      .eq("is_active", true)
      .order("company_name", { ascending: true }),
  ]);
  return {
    employees: employees ?? [],
    subcontractors: subcontractors ?? [],
  };
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
  revalidatePath("/command-center");
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
  revalidatePath("/command-center");
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

/**
 * Confirm (or un-confirm) a schedule phase's dates with the sub/crew. A
 * confirmed phase goes firm — it stops floating with the cascade and shows as
 * locked on the board. Pass confirmedWith to record who locked it in.
 */
export async function setPhaseConfirmation(
  phaseId: string,
  projectId: string,
  isConfirmed: boolean,
  confirmedWith?: string | null,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const patch = isConfirmed
    ? {
        is_confirmed: true,
        confirmed_at: new Date().toISOString(),
        confirmed_with: confirmedWith?.trim() || null,
      }
    : { is_confirmed: false, confirmed_at: null, confirmed_with: null };

  const { error } = await supabase
    .from("schedule_phases")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", phaseId);

  if (error) return { error: error.message };

  revalidatePath("/command-center");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/schedule");
  return { error: null };
}
