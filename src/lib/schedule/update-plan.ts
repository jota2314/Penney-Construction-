/**
 * The Job Board's Update sheet, as arithmetic: a job's master steps and a
 * person's answers go in, the exact writes come out. No database, no clock,
 * so the rules can be tested on their own (scripts/schedule-update-plan.test.mjs).
 *
 *   done         the step is finished
 *   going        started, not finished: it now ends on `end`
 *   not_started  past its date and never started: it now starts on `start`
 *   move         an upcoming step moved to `start`; its status is left alone
 */

export interface PlanRow {
  id: string;
  name?: string | null;
  status: string | null;
  /** Effective dates, the same ones the board draws. */
  start_date: string | null;
  end_date: string | null;
}

export type PlanAnswer =
  | { id: string; kind: "done" }
  | { id: string; kind: "going"; end: string }
  | { id: string; kind: "not_started"; start: string }
  | { id: string; kind: "move"; start: string };

export interface PlanWrite {
  id: string;
  patch: {
    status?: "not_started" | "in_progress" | "completed";
    start_date?: string;
    end_date?: string;
  };
}

export interface SchedulePlan {
  error: string | null;
  /** One write per answer, in the order answered. */
  writes: PlanWrite[];
  /** Later open steps carried along by "push later steps". */
  tail: PlanWrite[];
}

export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

const isOpen = (row: PlanRow) => row.status !== "completed" && row.status !== "cancelled";

export function planScheduleUpdate({
  rows,
  answers,
  pushLater,
  today,
  canPush,
}: {
  rows: readonly PlanRow[];
  answers: readonly PlanAnswer[];
  pushLater: boolean;
  today: string;
  /** Whether a later step slides with a delay (dumpsters and orders don't). */
  canPush: (row: PlanRow) => boolean;
}): SchedulePlan {
  const fail = (error: string): SchedulePlan => ({ error, writes: [], tail: [] });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const answered = new Set(answers.map((a) => a.id));
  if (answered.size !== answers.length) return fail("A step was answered twice. Refresh and try again.");

  // A confirmed schedule has no step sitting past its date unanswered.
  const unanswered = rows.filter(
    (row) => isOpen(row) && (row.end_date || row.start_date || "") < today && !answered.has(row.id),
  );
  if (unanswered.length) {
    const one = unanswered.length === 1;
    return fail(
      `${unanswered.length} step${one ? " is" : "s are"} past the end date with no answer. Refresh and answer ${one ? "it" : "them"} first.`,
    );
  }

  const writes: PlanWrite[] = [];
  /** The earliest step pushed later, and by how many days. */
  let lead: { oldStart: string; delta: number } | null = null;

  for (const a of answers) {
    const row = byId.get(a.id);
    if (!row || !row.start_date) return fail("A step is no longer on this job's schedule. Refresh and try again.");
    const start = row.start_date;
    const end = row.end_date || row.start_date;
    const name = row.name || "A step";
    if (a.kind === "done") {
      writes.push({ id: a.id, patch: { status: "completed" } });
    } else if (a.kind === "going") {
      if (a.end < today) return fail(`"${name}" needs an end date of today or later.`);
      writes.push({ id: a.id, patch: { status: "in_progress", start_date: start > a.end ? a.end : start, end_date: a.end } });
    } else {
      if (a.kind === "not_started" && a.start < today) return fail(`"${name}" needs a start date of today or later.`);
      const delta = dayDiff(start, a.start);
      const patch: PlanWrite["patch"] = { start_date: a.start, end_date: shiftDay(end, delta) };
      if (a.kind === "not_started") patch.status = "not_started";
      writes.push({ id: a.id, patch });
      if (delta > 0 && (!lead || start < lead.oldStart)) lead = { oldStart: start, delta };
    }
  }

  // Open work that starts on or after the earliest moved step slides by the
  // same days. Steps answered directly keep the dates they were given.
  const tail: PlanWrite[] = [];
  if (pushLater && lead) {
    const { oldStart, delta } = lead;
    for (const row of rows) {
      if (answered.has(row.id) || !isOpen(row) || !row.start_date) continue;
      if (row.start_date < oldStart || !canPush(row)) continue;
      tail.push({
        id: row.id,
        patch: { start_date: shiftDay(row.start_date, delta), end_date: shiftDay(row.end_date || row.start_date, delta) },
      });
    }
    if (tail.length > 120) return fail("That would move too many steps at once. Move the later steps on the timeline.");
  }

  return { error: null, writes, tail };
}
