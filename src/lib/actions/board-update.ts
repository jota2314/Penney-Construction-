"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { canViewJobBoard } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { updateSchedulePhase } from "@/lib/actions/schedule";
import { callClaude, nowStamp } from "@/lib/ai/claude";
import { crewToday } from "@/lib/crew/schedule-dates";
import { canCarryFinishDelay, withEffectiveScheduleDates, type CascadeInput } from "@/lib/schedule/cascade";
import { isClockInRow } from "@/lib/schedule/health";
import { isMasterPhase } from "@/lib/schedule/progress";
import { planScheduleUpdate } from "@/lib/schedule/update-plan";

/**
 * The Job Board's "Update" sheet: one job, a short list of steps, three
 * answers each, then a stamp that says who confirmed the schedule and when.
 *
 * Every date and status still goes through `updateSchedulePhase`, so a step
 * changed here behaves exactly like one changed on the project page: the
 * audit trigger logs it, the forecast pins the same way, and people on a
 * confirmed step get the same "your dates changed" email.
 */

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const answerSchema = z.discriminatedUnion("kind", [
  /** The work is finished. An inspection marked done is recorded as passed. */
  z.object({ id: uuid, kind: z.literal("done") }),
  /** Started, not finished: it now ends on `end`. */
  z.object({ id: uuid, kind: z.literal("going"), end: day }),
  /** A step past its date that never started: it now starts on `start`. */
  z.object({ id: uuid, kind: z.literal("not_started"), start: day }),
  /** An upcoming step moved to a new start. Its status is left alone. */
  z.object({ id: uuid, kind: z.literal("move"), start: day }),
]);

const updateSchema = z.object({
  projectId: uuid,
  answers: z.array(answerSchema).max(60),
  /** Push the open steps after the earliest moved one by the same days. */
  pushLater: z.boolean(),
});

export type ScheduleAnswer = z.infer<typeof answerSchema>;

export interface ScheduleUpdateResult {
  error: string | null;
  /** Steps answered directly. */
  changed: number;
  /** Later steps carried along by "push later steps". */
  pushed: number;
  emailed: number;
}

type MasterRow = CascadeInput & {
  project_id: string;
  estimate_line_item_id: string | null;
};

const MASTER_COLUMNS =
  "id, project_id, name, event_type, phase_scope, sort_order, status, is_confirmed, is_manually_scheduled, start_date, end_date, planned_start_date, planned_end_date, actual_completed_at, estimate_line_item_id";

const NON_WORK_EVENTS = new Set(["meeting", "shop_meeting", "walkthrough"]);

/** The job's master work with the same effective dates the board draws. */
async function loadMaster(db: Awaited<ReturnType<typeof createClient>>, projectId: string) {
  const { data, error } = await db
    .from("schedule_phases")
    .select(MASTER_COLUMNS)
    .eq("project_id", projectId)
    .not("start_date", "is", null)
    .order("start_date")
    .order("id")
    .limit(1000);
  if (error) return { rows: null, error: "Couldn't read the schedule. Refresh and try again." };
  const master = ((data ?? []) as MasterRow[]).filter(
    (ph) => isMasterPhase(ph) && !isClockInRow({ ...ph, name: ph.name ?? "" }) && !NON_WORK_EVENTS.has(ph.event_type ?? ""),
  );
  return { rows: withEffectiveScheduleDates(master), error: null };
}

const isOpen = (ph: { status: string | null }) => ph.status !== "completed" && ph.status !== "cancelled";

export async function applyScheduleUpdate(input: z.infer<typeof updateSchema>): Promise<ScheduleUpdateResult> {
  const fail = (error: string, changed = 0, pushed = 0, emailed = 0): ScheduleUpdateResult => ({
    error,
    changed,
    pushed,
    emailed,
  });

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail("Check the dates and try again.");
  const { projectId, answers, pushLater } = parsed.data;

  const user = await getUser();
  if (!user) return fail("Not signed in");
  if (!canViewJobBoard({ role: user.profile?.role, email: user.profile?.email ?? user.email })) {
    return fail("Not allowed");
  }

  const db = await createClient();
  const { rows, error: loadError } = await loadMaster(db, projectId);
  if (!rows) return fail(loadError ?? "Couldn't read the schedule.");

  const plan = planScheduleUpdate({
    rows,
    answers,
    pushLater,
    today: crewToday(),
    // Dumpsters, orders and the like stay put, same as the forecast treats them.
    canPush: (row) => canCarryFinishDelay(row as MasterRow),
  });
  if (plan.error) return fail(plan.error);
  const { writes, tail } = plan;
  const byId = new Map(rows.map((ph) => [ph.id, ph]));

  let changed = 0;
  let pushed = 0;
  let emailed = 0;
  for (const [list, isTail] of [
    [writes, false],
    [tail, true],
  ] as const) {
    for (const w of list) {
      const res = await updateSchedulePhase(w.id, { project_id: projectId, ...w.patch });
      if (res.error) {
        revalidatePath("/board");
        const name = byId.get(w.id)?.name ?? "A step";
        return fail(`Saved ${changed + pushed} step${changed + pushed === 1 ? "" : "s"}, then "${name}" failed: ${res.error}`, changed, pushed, emailed);
      }
      if (isTail) pushed++;
      else changed++;
      emailed += res.notify?.emailed.length ?? 0;
    }
  }

  const { data: stamped, error: stampError } = await db
    .from("projects")
    .update({ schedule_confirmed_at: new Date().toISOString(), schedule_confirmed_by: user.id })
    .eq("id", projectId)
    .select("id");
  revalidatePath("/board");
  if (stampError || !stamped?.length) {
    return fail("The steps saved, but the confirmation didn't. Tap Confirm again.", changed, pushed, emailed);
  }

  return { error: null, changed, pushed, emailed };
}

// ── Suggested answers, read from the field logs ───────────────────

export type SuggestedPick = "done" | "going" | "not_started";

export interface StepSuggestion {
  pick: SuggestedPick;
  /** One short line: what in the logs points that way. */
  why: string;
}

interface LogRow {
  text: string | null;
  started_at: string;
  master_phase_id: string | null;
}

/**
 * For each step past its end date, what the last three weeks of field logs
 * say about it. A suggestion only pre-selects an answer; nothing is saved
 * until a person taps Confirm. Any failure returns no suggestions and the
 * sheet works without them.
 */
export async function suggestStepAnswers(projectId: string): Promise<Record<string, StepSuggestion>> {
  try {
    if (!uuid.safeParse(projectId).success) return {};
    const user = await getUser();
    if (!user || !canViewJobBoard({ role: user.profile?.role, email: user.profile?.email ?? user.email })) return {};

    const db = await createClient();
    const { rows } = await loadMaster(db, projectId);
    if (!rows) return {};
    const today = crewToday();
    const stale = rows
      .filter((ph) => isOpen(ph) && (ph.end_date || ph.start_date || "") < today)
      .slice(0, 30);
    if (!stale.length) return {};

    const since = new Date(Date.now() - 21 * 86400000).toISOString();
    const { data: logData } = await db
      .from("daily_logs")
      .select("text, started_at, master_phase_id")
      .eq("project_id", projectId)
      .gte("started_at", since)
      .not("text", "is", null)
      .order("started_at", { ascending: false })
      .limit(60);
    const stepName = new Map(rows.map((ph) => [ph.id, ph.name ?? ""]));
    const logs = ((logData ?? []) as LogRow[])
      .filter((l) => (l.text ?? "").trim().length > 10)
      .map((l) => ({
        date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", month: "2-digit", day: "2-digit" }).format(new Date(l.started_at)),
        text: l.text!.trim().slice(0, 320),
        ...(l.master_phase_id && stepName.get(l.master_phase_id) ? { loggedAgainst: stepName.get(l.master_phase_id) } : {}),
      }));

    // No logs at all is its own answer, and it doesn't need a model to say so.
    if (!logs.length) {
      return Object.fromEntries(
        stale.map((ph) => [ph.id, { pick: "not_started" as const, why: "No field logs on this job in three weeks." }]),
      );
    }

    const system = `You help keep Penney Construction's job schedule honest. Today: ${nowStamp()}

You get schedule steps that are past their end date and not marked done, plus the job's recent field logs (newest first). For each step, say what the logs show.

Return ONLY a JSON array, one object per step, same order:
[{"id":"<step id>","pick":"done"|"going"|"not_started"|"unknown","why":"<one short line>"}]

Rules:
- "done": a log clearly says this work was finished, passed, or work that can only follow it is underway.
- "going": the logs show it started and is not finished.
- "not_started": nothing in the logs touches it.
- "unknown": you can't tell. Never guess "done".
- "why" is under 14 words, plain words, and names the log date it rests on (e.g. "11/10 log: grout finished"). No names of people.
- No markdown, no prose outside the JSON.`;

    const reply = await callClaude(
      system,
      JSON.stringify({
        steps: stale.map((ph) => ({ id: ph.id, name: ph.name, planned: `${ph.start_date} to ${ph.end_date || ph.start_date}`, status: ph.status })),
        logs,
      }),
      1800,
    );
    const parsed = JSON.parse(reply.slice(reply.indexOf("["), reply.lastIndexOf("]") + 1)) as {
      id?: unknown;
      pick?: unknown;
      why?: unknown;
    }[];
    const staleIds = new Set(stale.map((ph) => ph.id));
    const out: Record<string, StepSuggestion> = {};
    for (const row of parsed) {
      if (typeof row.id !== "string" || !staleIds.has(row.id)) continue;
      if (row.pick !== "done" && row.pick !== "going" && row.pick !== "not_started") continue;
      out[row.id] = { pick: row.pick, why: typeof row.why === "string" ? row.why.slice(0, 120) : "" };
    }
    return out;
  } catch (error) {
    console.error("[board-update] suggestions failed:", error);
    return {};
  }
}
