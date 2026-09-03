"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { canViewJobBoard } from "@/lib/auth/role-access";
import { projectColor } from "@/lib/board/crew-colors";

/**
 * Cell edits for the crew board, written straight into `schedule_phases`.
 *
 * One person, one job, one day is the unit Jorge plans in. Underneath, the
 * board keeps those as runs: setting Tuesday to the same job Monday already
 * has extends Monday's row rather than adding a second one, so the lanes view
 * and the crew's own day view see "Danti, Mon–Tue" — one bar, not two stubs.
 * Clearing a day in the middle of a run splits it.
 *
 * Only rows this board wrote (`event_type = 'crew'`, a single assignee) get
 * reshaped. A phase somebody else created — a clock-in, a project-page
 * assignment — is left as it is; the most the board will do to one is take
 * this person off it.
 *
 * Confirmed rows are what the crew see on /crew (it filters to confirmed or
 * in-progress work). A proposed row stays on the board only.
 */

const CREW_EVENT_TYPE = "crew";
const PHASE_COLUMNS =
  "id, project_id, name, start_date, end_date, status, color, event_type, is_confirmed, assigned_employee_ids, assigned_sub_ids, phase_scope, notes";

interface PhaseRow {
  id: string;
  project_id: string | null;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  color: string | null;
  event_type: string | null;
  is_confirmed: boolean;
  assigned_employee_ids: string[] | null;
  assigned_sub_ids: string[] | null;
  phase_scope: string | null;
  notes: string | null;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date.");

const setSchema = z.object({
  personKind: z.enum(["employee", "sub"]),
  personId: z.string().uuid(),
  date: dateSchema,
  projectId: z.string().uuid("Pick a job."),
  scope: z.string().trim().max(120).optional(),
  confirmed: z.boolean(),
});

const clearSchema = z.object({
  personKind: z.enum(["employee", "sub"]),
  personId: z.string().uuid(),
  date: dateSchema,
  phaseId: z.string().uuid(),
});

export type SetCrewAssignmentInput = z.infer<typeof setSchema>;
export type ClearCrewAssignmentInput = z.infer<typeof clearSchema>;

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function assigneeCount(p: PhaseRow) {
  return (p.assigned_employee_ids?.length ?? 0) + (p.assigned_sub_ids?.length ?? 0);
}

function assignedTo(p: PhaseRow, kind: "employee" | "sub", id: string) {
  const list = kind === "employee" ? p.assigned_employee_ids : p.assigned_sub_ids;
  return (list ?? []).includes(id);
}

/** The board may reshape this row: it wrote it, and only this person is on it. */
function ownedSolo(p: PhaseRow, kind: "employee" | "sub", id: string) {
  return p.event_type === CREW_EVENT_TYPE && assigneeCount(p) === 1 && assignedTo(p, kind, id);
}

async function authed() {
  const user = await getUser();
  if (!user) return { error: "Not signed in" as const };
  const viewer = { role: user.profile?.role, email: user.profile?.email ?? user.email };
  if (!canViewJobBoard(viewer)) return { error: "Not allowed" as const };
  const name = user.profile?.full_name?.trim() || user.email || "Office";
  return { userId: user.profile?.id ?? user.id, name };
}

function assignmentColumn(kind: "employee" | "sub") {
  return kind === "employee" ? "assigned_employee_ids" : "assigned_sub_ids";
}

function revalidate(projectIds: (string | null | undefined)[]) {
  revalidatePath("/board");
  revalidatePath("/crew");
  revalidatePath("/schedule");
  revalidatePath("/command-center");
  for (const id of new Set(projectIds)) if (id) revalidatePath(`/projects/${id}`);
}

/**
 * Put a person on a job for one day. Replaces whatever board-written row
 * covered that day for them; leaves rows written elsewhere alone.
 */
export async function setCrewAssignment(input: SetCrewAssignmentInput) {
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details." };
  const { personKind, personId, date, projectId, confirmed } = parsed.data;

  const auth = await authed();
  if ("error" in auth) return { error: auth.error };
  const supabase = await createClient();
  const col = assignmentColumn(personKind);

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { error: "That job doesn't exist." };

  const name = parsed.data.scope?.trim() || project.name;
  const touched: (string | null)[] = [projectId];

  // Every board-written row that already covers this person on this day.
  const { data: coveringRows, error: loadErr } = await supabase
    .from("schedule_phases")
    .select(PHASE_COLUMNS)
    .eq("event_type", CREW_EVENT_TYPE)
    .contains(col, [personId])
    .lte("start_date", date)
    .gte("end_date", date);
  if (loadErr) return { error: loadErr.message };

  for (const row of (coveringRows ?? []) as PhaseRow[]) {
    touched.push(row.project_id);
    if (ownedSolo(row, personKind, personId)) {
      const res = await carveOut(supabase, row, date, auth.userId);
      if (res.error) return res;
    } else {
      // Shared row: step this person off it, leave the others.
      const res = await removePerson(supabase, row, personKind, personId);
      if (res.error) return res;
    }
  }

  const confirmedFields = confirmed
    ? { is_confirmed: true, confirmed_at: new Date().toISOString(), confirmed_with: auth.name }
    : { is_confirmed: false, confirmed_at: null, confirmed_with: null };

  const { data: created, error: insErr } = await supabase
    .from("schedule_phases")
    .insert({
      project_id: projectId,
      name,
      start_date: date,
      end_date: date,
      planned_start_date: date,
      planned_end_date: date,
      status: "not_started",
      sort_order: 0,
      phase_scope: "daily",
      event_type: CREW_EVENT_TYPE,
      color: projectColor(projectId),
      assigned_employee_ids: personKind === "employee" ? [personId] : [],
      assigned_sub_ids: personKind === "sub" ? [personId] : [],
      created_by: auth.userId,
      ...confirmedFields,
    })
    .select(PHASE_COLUMNS)
    .single();
  if (insErr || !created) return { error: insErr?.message ?? "Couldn't save." };

  const merge = await mergeNeighbors(supabase, created as PhaseRow, personKind, personId);
  if (merge.error) return merge;

  revalidate(touched);
  return { error: null };
}

/** Take a person off a job for one day. */
export async function clearCrewAssignment(input: ClearCrewAssignmentInput) {
  const parsed = clearSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details." };
  const { personKind, personId, date, phaseId } = parsed.data;

  const auth = await authed();
  if ("error" in auth) return { error: auth.error };
  const supabase = await createClient();

  const { data: row, error: loadErr } = await supabase
    .from("schedule_phases")
    .select(PHASE_COLUMNS)
    .eq("id", phaseId)
    .maybeSingle();
  if (loadErr) return { error: loadErr.message };
  if (!row) return { error: "That row is already gone." };
  const phase = row as PhaseRow;
  if (!assignedTo(phase, personKind, personId)) return { error: "They're not on that row." };

  const res = ownedSolo(phase, personKind, personId)
    ? await carveOut(supabase, phase, date, auth.userId)
    : await removePerson(supabase, phase, personKind, personId);
  if (res.error) return res;

  revalidate([phase.project_id]);
  return { error: null };
}

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Remove one day from a board-owned run: delete a single-day row, trim an
 * edge, or split the middle into two rows.
 */
async function carveOut(supabase: Db, row: PhaseRow, date: string, userId: string) {
  if (row.start_date === row.end_date) {
    const { error } = await supabase.from("schedule_phases").delete().eq("id", row.id);
    return { error: error?.message ?? null };
  }
  if (date === row.start_date) {
    const { error } = await supabase
      .from("schedule_phases")
      .update({ start_date: shiftDate(date, 1), planned_start_date: shiftDate(date, 1) })
      .eq("id", row.id);
    return { error: error?.message ?? null };
  }
  if (date === row.end_date) {
    const { error } = await supabase
      .from("schedule_phases")
      .update({ end_date: shiftDate(date, -1), planned_end_date: shiftDate(date, -1) })
      .eq("id", row.id);
    return { error: error?.message ?? null };
  }
  // Middle of the run: keep the head, add a tail.
  const tailStart = shiftDate(date, 1);
  const { error: tailErr } = await supabase.from("schedule_phases").insert({
    project_id: row.project_id,
    name: row.name,
    start_date: tailStart,
    end_date: row.end_date,
    planned_start_date: tailStart,
    planned_end_date: row.end_date,
    status: row.status,
    sort_order: 0,
    phase_scope: row.phase_scope ?? "daily",
    event_type: row.event_type,
    color: row.color,
    notes: row.notes,
    assigned_employee_ids: row.assigned_employee_ids ?? [],
    assigned_sub_ids: row.assigned_sub_ids ?? [],
    is_confirmed: row.is_confirmed,
    confirmed_at: row.is_confirmed ? new Date().toISOString() : null,
    created_by: userId,
  });
  if (tailErr) return { error: tailErr.message };
  const headEnd = shiftDate(date, -1);
  const { error: headErr } = await supabase
    .from("schedule_phases")
    .update({ end_date: headEnd, planned_end_date: headEnd })
    .eq("id", row.id);
  return { error: headErr?.message ?? null };
}

/** Drop a person from a row's assignee list; delete the row if that empties a board-written one. */
async function removePerson(supabase: Db, row: PhaseRow, kind: "employee" | "sub", id: string) {
  const remaining = ((kind === "employee" ? row.assigned_employee_ids : row.assigned_sub_ids) ?? []).filter(
    (x) => x !== id,
  );
  const others = kind === "employee" ? row.assigned_sub_ids?.length ?? 0 : row.assigned_employee_ids?.length ?? 0;
  if (remaining.length === 0 && others === 0 && row.event_type === CREW_EVENT_TYPE) {
    const { error } = await supabase.from("schedule_phases").delete().eq("id", row.id);
    return { error: error?.message ?? null };
  }
  const patch =
    kind === "employee" ? { assigned_employee_ids: remaining } : { assigned_sub_ids: remaining };
  const { error } = await supabase.from("schedule_phases").update(patch).eq("id", row.id);
  return { error: error?.message ?? null };
}

/**
 * Fold a freshly written single-day row into the matching runs either side
 * of it — same person, same job, same scope, same confirmation.
 */
async function mergeNeighbors(supabase: Db, row: PhaseRow, kind: "employee" | "sub", id: string) {
  const col = assignmentColumn(kind);
  const prevDay = shiftDate(row.start_date, -1);
  const nextDay = shiftDate(row.end_date, 1);

  const { data: candidates, error } = await supabase
    .from("schedule_phases")
    .select(PHASE_COLUMNS)
    .eq("event_type", CREW_EVENT_TYPE)
    .contains(col, [id])
    .eq("name", row.name)
    .eq("is_confirmed", row.is_confirmed)
    .or(`end_date.eq.${prevDay},start_date.eq.${nextDay}`);
  if (error) return { error: error.message };

  const matches = ((candidates ?? []) as PhaseRow[]).filter(
    (c) => c.id !== row.id && c.project_id === row.project_id && ownedSolo(c, kind, id),
  );
  const prev = matches.find((c) => c.end_date === prevDay);
  const next = matches.find((c) => c.start_date === nextDay);
  if (!prev && !next) return { error: null };

  const keep = prev ?? row;
  const newEnd = next ? next.end_date : row.end_date;
  const { error: upErr } = await supabase
    .from("schedule_phases")
    .update({ end_date: newEnd, planned_end_date: newEnd })
    .eq("id", keep.id);
  if (upErr) return { error: upErr.message };

  const drop = [prev ? row.id : null, next ? next.id : null].filter((x): x is string => !!x);
  if (drop.length) {
    const { error: delErr } = await supabase.from("schedule_phases").delete().in("id", drop);
    if (delErr) return { error: delErr.message };
  }
  return { error: null };
}
