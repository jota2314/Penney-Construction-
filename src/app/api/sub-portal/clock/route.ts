import { after, NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSubAccess } from "@/lib/sub-portal/access";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";
import { isSubOnJob } from "@/lib/sub-portal/active-jobs";
import { etDate, etTimeLabel, todayET } from "@/lib/sub-portal/et-day";
import { revalidateSchedule } from "@/lib/schedule/revalidate";
import { notifySubException, notifySubField } from "@/lib/notifications/sub-field-notify";
import type { SubClockResponse, SubExceptionChip } from "@/lib/sub-portal/payload";
import {
  MAX_POST_TEXT,
  findPhaseLink,
  isUuid,
  parseExceptions,
  recordVisit,
  withExceptionLabels,
} from "../logs/capture";

export const runtime = "nodejs";

const MAX_TAGS = 12;
const MAX_TAG_LEN = 40;
/** Phone clocks drift; two minutes ahead of the server is still "now". */
const CLOCK_SKEW_MS = 2 * 60_000;
/** An end time this far back is a correction ("forgot to clock out"), not now. */
const CORRECTION_MS = 10 * 60_000;
/** A closed shift older than this doesn't take new words from a clock-out retry. */
const STALE_SHIFT_MS = 18 * 3_600_000;

type Shift = {
  id: string;
  project_id: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  kind: string;
  text: string | null;
};

const SHIFT_COLUMNS = "id, project_id, started_at, ended_at, status, kind, text";

const json = (body: SubClockResponse, status = 200) => NextResponse.json(body, { status });
const fail = (error: string, status: number) => json({ error }, status);

/**
 * POST /api/sub-portal/clock  SubClockRequest — the optional time clock.
 * Sub time is presence, not payroll; no location is taken (v3 drops the
 * geofence stamp, so old shells' `loc` is ignored).
 *
 *   { action: "in", projectId }
 *     Opens a shift on one of his live jobs. One at a time: clocking in again
 *     on the same job returns the open shift; another job is refused. Writes
 *     today's visit (source 'clock') and updates the office's daily notice.
 *
 *   { action: "out", logId, text?, exceptions?, pendingPhotoCount?, endedAt?, subId? }
 *     Closes the open shift with the composer's text and chips; photos follow
 *     through /logs/photo with the same logId, and each chip pings the office
 *     like a post. `logId` is the shift his screen showed: a different shift,
 *     or a post, is refused (stale screen). A shift that is already closed
 *     answers ok again, so a clock-out retried from the phone's outbox never
 *     fails, and any words the first try didn't carry are added (new words for
 *     a shift closed over 18 hours ago are refused as stale). `endedAt` is
 *     "I forgot to clock out": after clock-in, not in the future.
 *     Old shells send no logId (the open shift is used) and `tags` / `note`.
 */
export async function POST(request: NextRequest) {
  const refused = await refuseStaffBrowser(request);
  if (refused) return refused;
  const access = await resolveSubAccess(request);
  if (!access) return fail("Not signed in", 401);
  const { supabase, subId } = access;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail("Bad request", 400);
  }
  if (!body || typeof body !== "object") return fail("Bad request", 400);

  if (body.action === "in") return clockIn(supabase, subId, body);
  if (body.action === "out") return clockOut(supabase, subId, body);
  return fail("Unknown action", 400);
}

/** His open shift, if any (newest first, in case an old double tap left two). */
async function openShift(supabase: SupabaseClient, subId: string): Promise<Shift | null> {
  const { data } = await supabase
    .from("daily_logs")
    .select(SHIFT_COLUMNS)
    .eq("subcontractor_id", subId)
    .eq("kind", "shift")
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Shift | null) ?? null;
}

async function projectName(supabase: SupabaseClient, projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const { data } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

async function clockIn(supabase: SupabaseClient, subId: string, body: Record<string, unknown>) {
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) return fail("Pick a job first", 400);

  const open = await openShift(supabase, subId);
  if (open) {
    if (open.project_id === projectId) return json({ ok: true, logId: open.id, started_at: open.started_at });
    const where = await projectName(supabase, open.project_id);
    return fail(`You're clocked in at ${where ?? "another job"}. Clock out there first.`, 409);
  }

  if (!(await isSubOnJob(supabase, subId, projectId))) return fail("That job isn't on your list", 403);

  const row = {
    project_id: projectId,
    subcontractor_id: subId,
    author_id: null,
    kind: "shift",
    status: "in_progress",
  };
  const link = await findPhaseLink(supabase, subId, projectId, todayET());
  let inserted = await supabase.from("daily_logs").insert({ ...row, ...link }).select("id, started_at").single();
  if (inserted.error && link.schedule_phase_id) {
    // A phase link the schedule triggers refuse must never block the clock.
    inserted = await supabase.from("daily_logs").insert(row).select("id, started_at").single();
  }
  if (inserted.error || !inserted.data) return fail(inserted.error?.message ?? "Couldn't clock in. Try again.", 500);
  const shift = inserted.data as { id: string; started_at: string };

  await recordVisit(supabase, { projectId, subId, source: "clock" });
  revalidateSchedule(projectId);
  // Every new shift: the notice's key decides between a first push and a quiet update.
  after(() => notifySubField({ subId, projectId, event: "clocked_in" }));

  return json({ ok: true, logId: shift.id, started_at: shift.started_at });
}

/** The words this clock-out adds: legacy "Work:" tags, then his text, with any chip labels. */
function clockOutWords(body: Record<string, unknown>, exceptions: SubExceptionChip[]): string {
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[])
        .map((t) => String(t ?? "").trim().slice(0, MAX_TAG_LEN))
        .filter(Boolean)
        .slice(0, MAX_TAGS)
    : [];
  const typed = [body.text, body.note]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join("\n");
  const words = [tags.length ? `Work: ${tags.join(", ")}` : "", typed].filter(Boolean).join("\n");
  return withExceptionLabels(words, exceptions);
}

const typedText = (body: Record<string, unknown>) =>
  [body.text, body.note].map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean).join("\n");

const hoursOf = (start: string, end: string) =>
  Number(Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000).toFixed(2));

async function clockOut(supabase: SupabaseClient, subId: string, body: Record<string, unknown>) {
  // Saved on the phone under another company's login (the outbox stamps
  // subId): refuse, and the phone keeps it for that company.
  if (typeof body.subId === "string" && body.subId && body.subId !== subId) {
    return fail("This was saved under another company's login. Sign in as that company to send it.", 409);
  }
  const exceptions = parseExceptions(body.exceptions);
  const pendingPhotos = Math.max(0, Math.floor(Number(body.pendingPhotoCount) || 0));
  const words = clockOutWords(body, exceptions);

  let shift: Shift | null;
  if (body.logId != null && body.logId !== "") {
    if (!isUuid(body.logId)) return fail("That shift isn't on your list. Open the app again.", 400);
    const { data } = await supabase
      .from("daily_logs")
      .select(SHIFT_COLUMNS)
      .eq("id", body.logId)
      .eq("subcontractor_id", subId)
      .maybeSingle();
    shift = (data as Shift | null) ?? null;
    if (!shift || shift.kind !== "shift") return fail("That shift isn't on your list. Open the app again.", 404);
  } else {
    shift = await openShift(supabase, subId);
    if (!shift) return fail("You're not clocked in.", 400);
  }

  if (shift.status !== "in_progress") return alreadyClosed(supabase, subId, shift, words, exceptions, body);

  // Optional corrected end time — for the "forgot to clock out" case.
  const now = new Date();
  let endedAt = now;
  if (typeof body.endedAt === "string" && body.endedAt) {
    const wanted = new Date(body.endedAt);
    if (Number.isNaN(wanted.getTime())) return fail("That end time doesn't look right.", 400);
    if (wanted.getTime() <= new Date(shift.started_at).getTime()) {
      return fail("End time has to be after you clocked in.", 400);
    }
    if (wanted.getTime() > now.getTime() + CLOCK_SKEW_MS) return fail("End time can't be in the future.", 400);
    endedAt = wanted > now ? now : wanted;
  }
  const endIso = endedAt.toISOString();
  const hours = hoursOf(shift.started_at, endIso);

  // The auto line keeps the shift readable in the office feed (bare
  // clock-outs are filtered out of it); his words make it a real log.
  const shiftLine = `On site ${etTimeLabel(shift.started_at)} – ${etTimeLabel(endIso)} (${hours.toFixed(1)} h)`;
  const text = [shiftLine, words].filter(Boolean).join("\n").slice(0, MAX_POST_TEXT);

  const { data: closed, error } = await supabase
    .from("daily_logs")
    .update({ status: "completed", ended_at: endIso, text })
    .eq("id", shift.id)
    .eq("subcontractor_id", subId)
    .eq("status", "in_progress")
    .select("id");
  if (error) return fail(error.message, 500);
  if (!closed?.length) {
    // Another try closed it a moment ago.
    const { data } = await supabase.from("daily_logs").select(SHIFT_COLUMNS).eq("id", shift.id).maybeSingle();
    if (data) return alreadyClosed(supabase, subId, data as Shift, words, exceptions, body);
    return fail("You're not clocked in.", 400);
  }

  const projectId = shift.project_id;
  if (projectId) {
    const hasContent = !!words || pendingPhotos > 0;
    // A corrected end time hours ago (or a shift from another day) must not
    // move "last seen" to now; it only closes the shift.
    const live = now.getTime() - endedAt.getTime() < CORRECTION_MS && etDate(shift.started_at) === todayET();
    if (live) await recordVisit(supabase, { projectId, subId, source: "clock", posts: hasContent ? 1 : 0 });
    revalidateSchedule(projectId);
    const typed = typedText(body);
    after(async () => {
      await Promise.all([
        live && hasContent ? notifySubField({ subId, projectId, event: "posted" }) : null,
        ...exceptions.map((kind) => notifySubException({ subId, projectId, logId: shift.id, kind, text: typed })),
      ]);
    });
  }

  return json({ ok: true, logId: shift.id, hours });
}

/**
 * The shift is already closed: a retry whose first answer got lost, or a
 * second phone. Answer ok so the outbox can finish; add his words if this
 * try carries any the row doesn't have yet, and make sure each chip's notice
 * exists (keyed, so a repeat never pings twice).
 */
async function alreadyClosed(
  supabase: SupabaseClient,
  subId: string,
  shift: Shift,
  words: string,
  exceptions: SubExceptionChip[],
  body: Record<string, unknown>,
) {
  const current = shift.text ?? "";
  if (words && !current.includes(words)) {
    // New words for a shift closed long ago are a stale screen, not a retry:
    // they belong in a fresh post, not on an old day.
    const closedAt = new Date(shift.ended_at ?? shift.started_at).getTime();
    if (Date.now() - closedAt > STALE_SHIFT_MS) {
      return fail("That shift was already closed. Post this as an update instead.", 409);
    }
    const text = [current, words].filter(Boolean).join("\n").slice(0, MAX_POST_TEXT);
    await supabase.from("daily_logs").update({ text }).eq("id", shift.id).eq("subcontractor_id", subId);
  }
  const projectId = shift.project_id;
  if (projectId && exceptions.length > 0) {
    const typed = typedText(body);
    after(async () => {
      await Promise.all(
        exceptions.map((kind) => notifySubException({ subId, projectId, logId: shift.id, kind, text: typed })),
      );
    });
  }
  const hours = shift.ended_at ? hoursOf(shift.started_at, shift.ended_at) : undefined;
  return json({ ok: true, logId: shift.id, hours });
}
