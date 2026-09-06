"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { pickCurrentEstimate } from "@/lib/estimates/current";
import { createScheduledEvent, deleteEvent } from "@/lib/google/calendar";
import {
  notifySchedulePhaseAssignees,
  formatShortRange,
  type ScheduleNotifyResult,
} from "@/lib/notifications/schedule-notify";

interface SchedulePhaseInput {
  project_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  status?: string;
  is_manually_scheduled?: boolean;
  sort_order?: number;
  assigned_employee_ids?: string[];
  assigned_sub_ids?: string[];
  color?: string;
  notes?: string;
}

const schedulePhaseBaseSchema = z.object({
  project_id: z.string().uuid("Choose a valid project."),
  name: z.string().trim().min(1, "Schedule item is required.").max(120),
  description: z.string().trim().max(500).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid start date."),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid end date."),
  is_manually_scheduled: z.boolean().optional(),
  status: z
    .enum(["not_started", "in_progress", "completed", "on_hold"])
    .optional(),
  sort_order: z.number().int().min(0).optional(),
  assigned_employee_ids: z.array(z.string().uuid()).max(100).optional(),
  assigned_sub_ids: z.array(z.string().uuid()).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const schedulePhaseInputSchema = schedulePhaseBaseSchema.refine(
  (input) => input.end_date >= input.start_date,
  {
    message: "End date must be on or after the start date.",
    path: ["end_date"],
  },
);

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

/**
 * Active projects for the schedule quick-add picker. Lazy-loaded when the
 * user taps "+ Add" on the Command Center schedule strip — the strip only
 * receives already-scheduled projects, so it can't build this list itself.
 */
export async function getScheduleProjectOptions() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, project_number")
    .in("status", ["lead", "estimating", "proposal_sent", "contracted", "in_progress"])
    .order("name");
  return data ?? [];
}

const schedulePhasePatchSchema = schedulePhaseBaseSchema
  .partial()
  .required({ project_id: true })
  .refine(
    (input) =>
      !input.start_date || !input.end_date || input.end_date >= input.start_date,
    {
      message: "End date must be on or after the start date.",
      path: ["end_date"],
    },
  );

/**
 * Partial update — only the provided keys are written, so callers that don't
 * know about e.g. assigned_sub_ids can't clobber them. If the phase is
 * CONFIRMED, changes notify the people on it: newly-added assignees get the
 * "you're scheduled" email; date moves send a "schedule update" to everyone
 * already on the phase. Tentative phases never email.
 */
export async function updateSchedulePhase(
  id: string,
  input: Partial<SchedulePhaseInput> & { project_id: string },
): Promise<{ error: string | null; notify?: ScheduleNotifyResult }> {
  const parsed = schedulePhasePatchSchema.safeParse(input);
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

  const { data: before } = await supabase
    .from("schedule_phases")
    .select("is_confirmed, start_date, end_date, assigned_employee_ids, assigned_sub_ids")
    .eq("id", id)
    .single();
  if (!before) return { error: "Phase not found" };

  const patch: Record<string, unknown> = {};
  if (validated.is_manually_scheduled !== undefined) patch.is_manually_scheduled = validated.is_manually_scheduled;
  if (validated.name !== undefined) patch.name = validated.name;
  if (validated.description !== undefined) patch.description = validated.description || null;
  if (validated.start_date !== undefined) patch.start_date = validated.start_date;
  if (validated.end_date !== undefined) patch.end_date = validated.end_date;
  if (validated.status !== undefined) patch.status = validated.status;
  if (validated.sort_order !== undefined) patch.sort_order = validated.sort_order;
  if (validated.assigned_employee_ids !== undefined)
    patch.assigned_employee_ids = validated.assigned_employee_ids;
  if (validated.assigned_sub_ids !== undefined)
    patch.assigned_sub_ids = validated.assigned_sub_ids;
  if (validated.color !== undefined) patch.color = validated.color;
  if (validated.notes !== undefined) patch.notes = validated.notes || null;
  if (Object.keys(patch).length === 0) return { error: null };
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("schedule_phases")
    .update(patch)
    .eq("id", id);

  if (error) return { error: error.message };

  let notify: ScheduleNotifyResult | undefined;
  if (before.is_confirmed) {
    const oldEmps: string[] = before.assigned_employee_ids ?? [];
    const oldSubs: string[] = before.assigned_sub_ids ?? [];
    const addedEmps =
      validated.assigned_employee_ids?.filter((eid) => !oldEmps.includes(eid)) ?? [];
    const addedSubs =
      validated.assigned_sub_ids?.filter((sid) => !oldSubs.includes(sid)) ?? [];
    const newStart = validated.start_date ?? before.start_date;
    const newEnd = validated.end_date ?? before.end_date;
    const datesChanged =
      newStart !== before.start_date || newEnd !== before.end_date;

    if (addedEmps.length || addedSubs.length) {
      notify = await notifySchedulePhaseAssignees({
        phaseId: id,
        kind: "confirmed",
        actorId: user.id,
        onlyEmployeeIds: addedEmps,
        onlySubIds: addedSubs,
      });
    }
    if (datesChanged) {
      // Pre-existing assignees get the update; the newly added were just
      // welcomed with the confirmed email carrying the new dates already.
      const existingEmps = (validated.assigned_employee_ids ?? oldEmps).filter(
        (eid) => oldEmps.includes(eid),
      );
      const existingSubs = (validated.assigned_sub_ids ?? oldSubs).filter(
        (sid) => oldSubs.includes(sid),
      );
      if (existingEmps.length || existingSubs.length) {
        const updateResult = await notifySchedulePhaseAssignees({
          phaseId: id,
          kind: "updated",
          actorId: user.id,
          changes: [
            `Dates: ${formatShortRange(before.start_date, before.end_date)} → ${formatShortRange(newStart, newEnd)}`,
          ],
          onlyEmployeeIds: existingEmps,
          onlySubIds: existingSubs,
        });
        notify = notify
          ? {
              emailed: [...notify.emailed, ...updateResult.emailed],
              skipped: [...new Set([...notify.skipped, ...updateResult.skipped])],
              pushed: notify.pushed + updateResult.pushed,
              error: notify.error ?? updateResult.error,
            }
          : updateResult;
      }
    }
  }

  revalidatePath(`/projects/${input.project_id}`);
  revalidatePath("/schedule");
  revalidatePath("/command-center");
  return { error: null, notify };
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
 * The plan comes from the estimate: one master phase per visible line item of
 * the current estimate (admin/permit lines excluded), skipping lines already
 * linked to a phase. Material lines become "Order — …" steps. New steps land
 * at the end of the current plan on the same date, unconfirmed — the portal
 * keeps its completion estimate and shows them as Estimated until they're
 * actually scheduled.
 */
export async function buildPlanFromEstimate(
  projectId: string,
): Promise<{ error: string | null; created: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", created: 0 };

  const [{ data: project }, { data: estimates }] = await Promise.all([
    supabase.from("projects").select("contract_estimate_id").eq("id", projectId).single(),
    supabase
      .from("estimates")
      .select("id, status, version")
      .eq("project_id", projectId)
      .order("version", { ascending: false }),
  ]);
  const current = pickCurrentEstimate(
    estimates ?? [],
    (project as { contract_estimate_id?: string | null } | null)?.contract_estimate_id,
  );
  if (!current) return { error: "No estimate on this project yet.", created: 0 };

  const [{ data: lines }, { data: existing }] = await Promise.all([
    supabase
      .from("estimate_line_items")
      .select("id, description, sort_order")
      .eq("estimate_id", current.id)
      .eq("is_visible_on_proposal", true)
      .eq("is_section_header", false)
      .order("sort_order", { ascending: true }),
    supabase
      .from("schedule_phases")
      .select("name, estimate_line_item_id, sort_order, end_date, phase_scope")
      .eq("project_id", projectId),
  ]);

  const linked = new Set(
    (existing ?? []).filter((p) => p.phase_scope !== "daily").map((p) => p.estimate_line_item_id).filter(Boolean),
  );
  const masterEnds = (existing ?? [])
    .filter((p) => p.phase_scope !== "daily" && p.end_date)
    .map((p) => p.end_date as string)
    .sort();
  const anchor =
    masterEnds[masterEnds.length - 1] ?? new Date().toISOString().split("T")[0];
  let sort = Math.max(0, ...(existing ?? []).map((p) => p.sort_order ?? 0));

  const isAdmin = (t: string) => /admin|permit/i.test(t);
  const isMaterial = (t: string) => /materials?\b|lumber/i.test(t);

  const rows = (lines ?? [])
    .filter((l) => l.description && !isAdmin(l.description) && !linked.has(l.id))
    .map((l) => ({
      project_id: projectId,
      name: isMaterial(l.description) ? `Order — ${l.description}` : l.description,
      start_date: anchor,
      end_date: anchor,
      status: "not_started",
      phase_scope: "master",
      estimate_line_item_id: l.id,
      sort_order: ++sort,
      color: "#3b82f6",
      created_by: user.id,
    }));

  // Every job gets its inspections as milestones — which ones depends on the
  // scope. A bathroom has no footings inspection, but rough plumbing/electrical
  // and final it does. Inferred from the estimate lines; final always.
  const INSPECTIONS: { match: RegExp | null; name: string; description: string }[] = [
    { match: /footing|foundation|concrete|excavat/i, name: "Inspection — Footings & Foundation", description: "Building department sign-off on footings and foundation." },
    { match: /plumbing/i, name: "Inspection — Rough Plumbing", description: "Rough plumbing and gas inspection before the walls close." },
    { match: /electrical/i, name: "Inspection — Rough Electrical", description: "Rough electrical inspection before the walls close." },
    { match: /hvac|mechanical/i, name: "Inspection — Rough Mechanical", description: "Rough mechanical inspection before the walls close." },
    { match: /fram|steel|beam|structur/i, name: "Inspection — Rough Frame", description: "Framing inspection after roughs are signed off." },
    { match: /insulation/i, name: "Inspection — Insulation", description: "Insulation and energy inspection before drywall." },
    { match: null, name: "Inspection — Final Building", description: "Final building inspection and sign-off." },
  ];
  const allLineText = (lines ?? []).map((l) => l.description ?? "").join(" | ");
  const existingNames = new Set(
    (existing ?? []).map((p) => ((p as { name?: string | null }).name ?? "").toLowerCase()),
  );
  const inspectionRows = INSPECTIONS.filter(
    (i) => (i.match === null || i.match.test(allLineText)) && !existingNames.has(i.name.toLowerCase()),
  ).map((i) => ({
    project_id: projectId,
    name: i.name,
    description: i.description,
    start_date: anchor,
    end_date: anchor,
    status: "not_started",
    phase_scope: "master",
    event_type: "inspection",
    sort_order: ++sort,
    color: "#ef4444",
    created_by: user.id,
  }));

  const allRows = [...rows, ...inspectionRows];
  if (allRows.length === 0) return { error: null, created: 0 };
  const { error } = await supabase.from("schedule_phases").insert(allRows);
  if (error) return { error: error.message, created: 0 };

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/schedule");
  return { error: null, created: rows.length };
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
 * Confirm (or un-confirm) a schedule phase. Confirming puts the phase LIVE:
 * it appears on the /schedule calendar, the crew app, and the Command Center
 * tile, and everyone assigned gets a "you're scheduled" email (CC office) plus
 * a push. A phase can only go live with at least one person attached AND a
 * budget line item attached. Pass confirmedWith to record who locked it in.
 */
export async function setPhaseConfirmation(
  phaseId: string,
  projectId: string,
  isConfirmed: boolean,
  confirmedWith?: string | null,
): Promise<{ error: string | null; notify?: ScheduleNotifyResult }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: phase } = await supabase
    .from("schedule_phases")
    .select("is_confirmed, assigned_employee_ids, assigned_sub_ids, estimate_line_item_id")
    .eq("id", phaseId)
    .single();
  if (!phase) return { error: "Phase not found" };

  if (isConfirmed) {
    // Already live — don't re-send "you're scheduled" emails on a double tap.
    if (phase.is_confirmed) return { error: null };

    const hasPeople =
      (phase.assigned_employee_ids?.length ?? 0) > 0 ||
      (phase.assigned_sub_ids?.length ?? 0) > 0;
    const hasBudgetLine = phase.estimate_line_item_id != null;
    if (!hasPeople && !hasBudgetLine) {
      return {
        error:
          "Add a crew member or sub AND attach a budget line item before putting this live.",
      };
    }
    if (!hasPeople) {
      return { error: "Add a crew member or sub before putting this live." };
    }
    if (!hasBudgetLine) {
      return { error: "Attach a budget line item before putting this live." };
    }
  }

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

  let notify: ScheduleNotifyResult | undefined;
  if (isConfirmed) {
    notify = await notifySchedulePhaseAssignees({
      phaseId,
      kind: "confirmed",
      actorId: user.id,
    });
  }

  revalidatePath("/command-center");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/schedule");
  return { error: null, notify };
}
