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
 * One person, one job, one day is the unit Jorge plans in — and a person can
 * carry two or three jobs on the same day (a morning punch at one house, the
 * afternoon at another). Underneath, the board keeps each job as runs: setting Tuesday to the same job Monday already
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
  "id, project_id, name, start_date, end_date, status, color, event_type, is_confirmed, confirmed_at, confirmed_with, assigned_employee_ids, assigned_sub_ids, phase_scope, notes, estimate_line_item_id";

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
  confirmed_at: string | null;
  confirmed_with: string | null;
  assigned_employee_ids: string[] | null;
  assigned_sub_ids: string[] | null;
  phase_scope: string | null;
  notes: string | null;
  /** Clock-in reads the budget line off the phase — a split must keep it. */
  estimate_line_item_id: string | null;
}

/**
 * The parts of a row that every piece of it keeps when it's split: the job,
 * the words, the budget line, and who confirmed it and when.
 */
function carriedFields(row: PhaseRow, line: string | null) {
  return {
    project_id: row.project_id,
    name: row.name,
    status: row.status,
    sort_order: 0,
    phase_scope: row.phase_scope ?? "daily",
    event_type: row.event_type,
    color: row.color,
    notes: row.notes,
    estimate_line_item_id: line,
    is_confirmed: row.is_confirmed,
    confirmed_at: row.is_confirmed ? (row.confirmed_at ?? new Date().toISOString()) : null,
    confirmed_with: row.is_confirmed ? row.confirmed_with : null,
  };
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date.");

const setSchema = z.object({
  personKind: z.enum(["employee", "sub"]),
  personId: z.string().uuid(),
  date: dateSchema,
  projectId: z.string().uuid("Pick a job."),
  scope: z.string().trim().max(120).optional(),
  confirmed: z.boolean(),
  /**
   * Editing an existing chip: that day comes off this row first, so changing
   * the job or the words replaces it instead of adding a second chip.
   */
  replacePhaseId: z.string().uuid().optional(),
});

const cellSchema = z.object({
  personKind: z.enum(["employee", "sub"]),
  personId: z.string().uuid(),
  date: dateSchema,
});

const assignCellsSchema = z.object({
  cells: z.array(cellSchema).min(1, "Pick at least one day.").max(200, "That's too many days at once."),
  projectId: z.string().uuid("Pick a job."),
  scope: z.string().trim().max(120).optional(),
  confirmed: z.boolean(),
});

const clearCellsSchema = z.object({
  cells: z.array(cellSchema).min(1).max(200),
});

const confirmSchema = z.object({
  phaseIds: z.array(z.string().uuid()).min(1, "Nothing to confirm.").max(500),
});

/**
 * The budget line a new row may carry. A closed (locked) line can't take new
 * schedule rows — the database refuses them — so the new piece goes without
 * one and the office allocates it, rather than the whole edit failing.
 */
async function usableLine(supabase: Db, lineId: string | null | undefined): Promise<string | null> {
  if (!lineId) return null;
  const { data } = await supabase
    .from("estimate_line_items")
    .select("id, is_locked")
    .eq("id", lineId)
    .maybeSingle();
  return data && !data.is_locked ? lineId : null;
}

/** A chip whose row changed under it — another move landed first. */
const STALE_DAY = "That day changed since the board loaded. Refresh and try again.";

const clearSchema = z.object({
  personKind: z.enum(["employee", "sub"]),
  personId: z.string().uuid(),
  date: dateSchema,
  phaseId: z.string().uuid(),
});

const moveSchema = z.object({
  phaseId: z.string().uuid(),
  fromKind: z.enum(["employee", "sub"]),
  fromId: z.string().uuid(),
  fromDate: dateSchema,
  toKind: z.enum(["employee", "sub"]),
  toId: z.string().uuid(),
  toDate: dateSchema,
  /** Leave the original where it is and put a copy at the destination. */
  copy: z.boolean().optional(),
});

export type MoveCrewAssignmentInput = z.infer<typeof moveSchema>;
export type SetCrewAssignmentInput = z.infer<typeof setSchema>;
export type ClearCrewAssignmentInput = z.infer<typeof clearSchema>;
export type CrewCellRef = z.infer<typeof cellSchema>;
export type AssignCrewCellsInput = z.infer<typeof assignCellsSchema>;

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

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { error: "That job doesn't exist." };

  const name = parsed.data.scope?.trim() || project.name;

  const touchedBefore: (string | null)[] = [];
  let carry: Placement["carry"];
  if (parsed.data.replacePhaseId) {
    const { data: row } = await supabase
      .from("schedule_phases")
      .select(PHASE_COLUMNS)
      .eq("id", parsed.data.replacePhaseId)
      .maybeSingle();
    const old = row as PhaseRow | null;
    // The chip being edited has to still be there, still theirs, still on
    // this day — otherwise saving would add a second chip, not replace one.
    if (!old || !assignedTo(old, personKind, personId) || date < old.start_date || date > old.end_date) {
      return { error: STALE_DAY };
    }
    touchedBefore.push(old.project_id);
    // Same job, new words: the day keeps its budget line and notes.
    if (old.project_id === projectId) carry = { lineId: old.estimate_line_item_id, notes: old.notes };
    const res = await takeOffDay(supabase, old, personKind, personId, date, auth.userId);
    if (res.error) return { error: res.error };
  }

  const placed = await place(supabase, {
    personKind,
    personId,
    date,
    projectId,
    name,
    confirmed,
    userId: auth.userId,
    userName: auth.name,
    carry,
  });
  if (placed.error) return { error: placed.error };

  revalidate([...touchedBefore, ...placed.touched]);
  return { error: null };
}

/**
 * Fill a block of cells with one job — drag across Mon–Fri for three people,
 * pick the job, done. Each cell goes through the same placement as a single
 * tap, so consecutive days fold into one run per person.
 */
export async function assignCrewCells(input: AssignCrewCellsInput) {
  const parsed = assignCellsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details." };
  const { cells, projectId, confirmed } = parsed.data;

  const auth = await authed();
  if ("error" in auth) return { error: auth.error };
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { error: "That job doesn't exist." };
  const name = parsed.data.scope?.trim() || project.name;

  // Person by person, day by day — so each insert can fold into yesterday's.
  const ordered = [...cells].sort(
    (a, b) =>
      a.personKind.localeCompare(b.personKind) ||
      a.personId.localeCompare(b.personId) ||
      a.date.localeCompare(b.date),
  );
  const touched: (string | null)[] = [];
  for (const cell of ordered) {
    const placed = await place(supabase, {
      ...cell,
      projectId,
      name,
      confirmed,
      userId: auth.userId,
      userName: auth.name,
    });
    touched.push(...placed.touched);
    if (placed.error) {
      revalidate(touched);
      return { error: placed.error };
    }
  }

  revalidate(touched);
  return { error: null };
}

/**
 * Empty a block of cells. Only rows this board wrote are reshaped; a person
 * on a master-schedule phase is stepped off it, the phase itself stays.
 */
export async function clearCrewCells(input: { cells: CrewCellRef[] }) {
  const parsed = clearCellsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details." };

  const auth = await authed();
  if ("error" in auth) return { error: auth.error };
  const supabase = await createClient();

  const touched: (string | null)[] = [];
  for (const cell of parsed.data.cells) {
    const col = assignmentColumn(cell.personKind);
    const { data: rows, error } = await supabase
      .from("schedule_phases")
      .select(PHASE_COLUMNS)
      .eq("event_type", CREW_EVENT_TYPE)
      .contains(col, [cell.personId])
      .lte("start_date", cell.date)
      .gte("end_date", cell.date);
    if (error) return { error: error.message };
    for (const row of (rows ?? []) as PhaseRow[]) {
      touched.push(row.project_id);
      const res = await takeOffDay(supabase, row, cell.personKind, cell.personId, cell.date, auth.userId);
      if (res.error) {
        revalidate(touched);
        return { error: res.error };
      }
    }
  }

  revalidate(touched);
  return { error: null };
}

/**
 * Confirm exactly the proposed crew rows the board counted on screen.
 * Confirmed is what puts a day on the worker's own /crew view; nothing is
 * emailed — the crew board never has.
 */
export async function confirmCrewPhases(input: { phaseIds: string[] }) {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Nothing to confirm.", count: 0 };

  const auth = await authed();
  if ("error" in auth) return { error: auth.error, count: 0 };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("schedule_phases")
    .update({
      is_confirmed: true,
      confirmed_at: new Date().toISOString(),
      confirmed_with: auth.name,
    })
    .in("id", parsed.data.phaseIds)
    .eq("event_type", CREW_EVENT_TYPE)
    .eq("is_confirmed", false)
    .select("id, project_id");
  if (error) return { error: error.message, count: 0 };

  revalidate((data ?? []).map((r) => r.project_id));
  return { error: null, count: data?.length ?? 0 };
}

interface Placement {
  personKind: "employee" | "sub";
  personId: string;
  date: string;
  projectId: string;
  name: string;
  confirmed: boolean;
  userId: string;
  userName: string;
  /** A moved or edited day keeps its budget line and notes. */
  carry?: { lineId: string | null; notes: string | null };
}

/**
 * Put one person on one job for one day: clear the board row that already had
 * them on THIS job that day (so re-saving replaces rather than doubles), write
 * the new one, then fold it into the runs either side. Other jobs the same day
 * are left alone — a person can carry two or three. Shared by the cell editor,
 * the block fill and drag-and-drop.
 */
async function place(
  supabase: Db,
  p: Placement,
): Promise<{ error: string | null; touched: (string | null)[] }> {
  const col = assignmentColumn(p.personKind);
  const touched: (string | null)[] = [p.projectId];

  // The board row that already has this person on this job this day.
  const { data: coveringRows, error: loadErr } = await supabase
    .from("schedule_phases")
    .select(PHASE_COLUMNS)
    .eq("event_type", CREW_EVENT_TYPE)
    .eq("project_id", p.projectId)
    .contains(col, [p.personId])
    .lte("start_date", p.date)
    .gte("end_date", p.date);
  if (loadErr) return { error: loadErr.message, touched };

  const covering = (coveringRows ?? []) as PhaseRow[];
  // Re-assigning a day they already had on this job keeps that day's budget
  // line and notes, unless the caller is bringing its own.
  const carry =
    p.carry ?? (covering[0] ? { lineId: covering[0].estimate_line_item_id, notes: covering[0].notes } : undefined);
  for (const row of covering) {
    touched.push(row.project_id);
    const res = await takeOffDay(supabase, row, p.personKind, p.personId, p.date, p.userId);
    if (res.error) return { error: res.error, touched };
  }

  const confirmedFields = p.confirmed
    ? { is_confirmed: true, confirmed_at: new Date().toISOString(), confirmed_with: p.userName }
    : { is_confirmed: false, confirmed_at: null, confirmed_with: null };

  const { data: created, error: insErr } = await supabase
    .from("schedule_phases")
    .insert({
      project_id: p.projectId,
      name: p.name,
      start_date: p.date,
      end_date: p.date,
      planned_start_date: p.date,
      planned_end_date: p.date,
      status: "not_started",
      sort_order: 0,
      phase_scope: "daily",
      event_type: CREW_EVENT_TYPE,
      color: projectColor(p.projectId),
      estimate_line_item_id: await usableLine(supabase, carry?.lineId),
      notes: carry?.notes ?? null,
      assigned_employee_ids: p.personKind === "employee" ? [p.personId] : [],
      assigned_sub_ids: p.personKind === "sub" ? [p.personId] : [],
      created_by: p.userId,
      ...confirmedFields,
    })
    .select(PHASE_COLUMNS)
    .single();
  if (insErr || !created) return { error: insErr?.message ?? "Couldn't save.", touched };

  const merge = await mergeNeighbors(supabase, created as PhaseRow, p.personKind, p.personId);
  if (merge.error) return { error: merge.error, touched };

  return { error: null, touched };
}

/**
 * Drag a day of work to another person, another day, or both.
 *
 * Only rows this board wrote move. A master-schedule phase covers days and
 * people this grid can't see, so dragging one would quietly rewrite the job's
 * schedule; those stay put and the grid marks them read-only.
 */
export async function moveCrewAssignment(input: MoveCrewAssignmentInput) {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details." };
  const { phaseId, fromKind, fromId, fromDate, toKind, toId, toDate, copy } = parsed.data;

  if (fromKind === toKind && fromId === toId && fromDate === toDate) return { error: null };

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
  if (!assignedTo(phase, fromKind, fromId)) return { error: "They're not on that row." };
  if (fromDate < phase.start_date || fromDate > phase.end_date) return { error: STALE_DAY };
  if (!phase.project_id) return { error: "That row has no job on it." };
  if (!copy && !ownedSolo(phase, fromKind, fromId)) {
    return { error: "That one comes from the job's schedule \u2014 move it on the Jobs view or the project page." };
  }

  if (!copy) {
    // Lift the day out first, so moving inside a run can't collide with itself.
    const carved = await carveOut(supabase, phase, fromDate, auth.userId);
    if (carved.error) return { error: carved.error };
  }

  const placed = await place(supabase, {
    personKind: toKind,
    personId: toId,
    date: toDate,
    projectId: phase.project_id,
    name: phase.name,
    confirmed: phase.is_confirmed,
    userId: auth.userId,
    userName: auth.name,
    carry: { lineId: phase.estimate_line_item_id, notes: phase.notes },
  });
  if (placed.error) return { error: placed.error };

  revalidate([phase.project_id, ...placed.touched]);
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

  const res = await takeOffDay(supabase, phase, personKind, personId, date, auth.userId);
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
  // A chip from a stale board can point at a row that has since been split;
  // without this a one-day row would be deleted for a day it doesn't cover.
  if (date < row.start_date || date > row.end_date) return { error: STALE_DAY };
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
    ...carriedFields(row, await usableLine(supabase, row.estimate_line_item_id)),
    start_date: tailStart,
    end_date: row.end_date,
    planned_start_date: tailStart,
    planned_end_date: row.end_date,
    assigned_employee_ids: row.assigned_employee_ids ?? [],
    assigned_sub_ids: row.assigned_sub_ids ?? [],
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

/**
 * Take one person off ONE day of a row, whatever its shape.
 *
 *   solo board run    carve the day out (delete / trim / split)
 *   shared crew run   drop them from the row, then give them back their
 *                     other days as their own run — stepping off Tuesday
 *                     mustn't also take them off Monday and Wednesday
 *   anything else     a master-schedule phase is never reshaped here; the
 *                     person just comes off it, as before
 */
async function takeOffDay(
  supabase: Db,
  row: PhaseRow,
  kind: "employee" | "sub",
  id: string,
  date: string,
  userId: string,
): Promise<{ error: string | null }> {
  // Every branch: the row has to still cover the day the chip was on.
  if (date < row.start_date || date > row.end_date) return { error: STALE_DAY };
  if (ownedSolo(row, kind, id)) return carveOut(supabase, row, date, userId);

  const splitting = row.event_type === CREW_EVENT_TYPE && row.start_date !== row.end_date;
  const line = splitting ? await usableLine(supabase, row.estimate_line_item_id) : null;

  // Off the shared row FIRST. If what follows fails, they've lost days —
  // visible, and redone with one drag — rather than doubled up on them,
  // which a retry would only make worse.
  const removed = await removePerson(supabase, row, kind, id);
  if (removed.error) return removed;

  if (splitting) {
    const pieces: [string, string][] = [];
    if (date > row.start_date) pieces.push([row.start_date, shiftDate(date, -1)]);
    if (date < row.end_date) pieces.push([shiftDate(date, 1), row.end_date]);
    for (const [start, end] of pieces) {
      const { error } = await supabase.from("schedule_phases").insert({
        ...carriedFields(row, line),
        start_date: start,
        end_date: end,
        planned_start_date: start,
        planned_end_date: end,
        assigned_employee_ids: kind === "employee" ? [id] : [],
        assigned_sub_ids: kind === "sub" ? [id] : [],
        created_by: userId,
      });
      if (error) return { error: `${error.message} — their other days on ${row.name} need re-adding.` };
    }
  }

  return { error: null };
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
  let prev = matches.find((c) => c.end_date === prevDay);
  let next = matches.find((c) => c.start_date === nextDay);

  // One run, one budget line. A neighbour booked to a different line stays
  // its own run; a day with no line joins whichever line its run has.
  const lineOf = (r: PhaseRow | undefined) => r?.estimate_line_item_id ?? null;
  let line = lineOf(row) ?? lineOf(prev) ?? lineOf(next);
  if (prev && lineOf(prev) && lineOf(prev) !== line) prev = undefined;
  if (next && lineOf(next) && lineOf(next) !== line) next = undefined;
  // A closed (locked) line can't be written onto another row — the database
  // refuses it — so a run booked to one stays its own run instead.
  const keeping = prev ?? next;
  if (line && keeping && lineOf(keeping) !== line && !(await usableLine(supabase, line))) {
    if (lineOf(prev) === line) prev = undefined;
    if (lineOf(next) === line) next = undefined;
    line = lineOf(row);
  }
  if (!prev && !next) return { error: null };

  // Keep a row that was already there — its notes, status and confirmer —
  // and fold the new day into it, rather than stretching the new row over it.
  const keep = (prev ?? next) as PhaseRow;
  const start = prev ? prev.start_date : row.start_date;
  const end = next ? next.end_date : row.end_date;
  const patch: Record<string, unknown> = {
    start_date: start,
    end_date: end,
    planned_start_date: start,
    planned_end_date: end,
  };
  if (lineOf(keep) !== line) patch.estimate_line_item_id = line;
  // The rows folded away may hold the only copy of a note — keep it.
  const notes = keep.notes || row.notes || (prev && next ? next.notes : null);
  if (notes !== keep.notes) patch.notes = notes;
  const { error: upErr } = await supabase.from("schedule_phases").update(patch).eq("id", keep.id);
  if (upErr) return { error: upErr.message };

  const drop = [row.id, prev && next ? next.id : null].filter((x): x is string => !!x);
  const { error: delErr } = await supabase.from("schedule_phases").delete().in("id", drop);
  if (delErr) return { error: delErr.message };
  return { error: null };
}
