import { revalidateSchedule } from "@/lib/schedule/revalidate";
import { after, NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSubAccess } from "@/lib/sub-portal/access";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";
import { isSubOnJob } from "@/lib/sub-portal/active-jobs";
import { etDate, todayET } from "@/lib/sub-portal/et-day";
import { notifySubException, notifySubField } from "@/lib/notifications/sub-field-notify";
import type { SubExceptionChip, SubPostCreateResponse } from "@/lib/sub-portal/payload";
import {
  MAX_POST_TEXT,
  findPhaseLink,
  isUuid,
  parseExceptions,
  recordVisit,
  withExceptionLabels,
  type PhaseLink,
} from "./capture";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/sub-portal/logs  SubPostCreateRequest
 *   { id, projectId, text, exceptions, pendingPhotoCount, postedAt?, subId? }
 *
 * Post a field update onto one of his live jobs: a completed daily log
 * (kind 'post') attributed to his company, author_id null. Photos follow
 * through /api/sub-portal/logs/photo.
 *
 *  - `id` is made on the phone. A retry hits the primary key (23505) and
 *    gets the existing row back with created: false, so a post sent on a
 *    dying signal never lands twice. Old app shells send no id; the server
 *    makes one, as before.
 *  - `postedAt` is when he tapped Post (the outbox sends it on every try),
 *    so a post sent late from the outbox is dated then, not when it
 *    arrived: at most ~2 minutes ahead (phone clock drift) and 7 days back,
 *    otherwise now. Old shells send none; it's now, as before.
 *  - `subId` is the company the phone saved it under. Another signed-in
 *    company gets 409 and the phone keeps it for the right login.
 *  - When exactly one work phase covering the post's day on this job is
 *    his, the post carries that phase and its budget line (plan §3.3).
 *  - A post from today: today's visit gets posts + 1 and the office's daily
 *    "MGL at Pedersen" notice updates (pushed once a day). A late post from
 *    an earlier day touches neither (sub_record_visit only counts today).
 *    Each exception chip pings the PM and Jorge once, whatever the day (a
 *    retry updates that notice instead).
 */
export async function POST(request: NextRequest) {
  const refused = await refuseStaffBrowser(request);
  if (refused) return refused;
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, subId } = access;

  let body: {
    id?: unknown;
    projectId?: unknown;
    text?: unknown;
    exceptions?: unknown;
    pendingPhotoCount?: unknown;
    postedAt?: unknown;
    subId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // Saved on the phone under another company's login: never post it as this one.
  if (typeof body.subId === "string" && body.subId && body.subId !== subId) {
    return NextResponse.json(
      { error: "This was saved under another company's login. Sign in as that company to send it." },
      { status: 409 },
    );
  }

  const id = body.id == null || body.id === "" ? null : body.id;
  if (id !== null && !isUuid(id)) return badId();
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const typed = (typeof body.text === "string" ? body.text : "").trim();
  const exceptions = parseExceptions(body.exceptions);
  const pendingPhotos = Math.max(0, Math.floor(Number(body.pendingPhotoCount) || 0));
  if (!projectId) return NextResponse.json({ error: "Pick a job first" }, { status: 400 });
  if (!typed && pendingPhotos === 0 && exceptions.length === 0) {
    return NextResponse.json({ error: "Add a note or a photo before posting" }, { status: 400 });
  }
  const text = withExceptionLabels(typed, exceptions).slice(0, MAX_POST_TEXT);

  // A retry of a post that already landed is answered before the job check,
  // so it still succeeds if the job dropped off his list in between.
  if (id) {
    const existing = await findOwnPost(supabase, id, subId);
    if (existing === "taken") return badId(409);
    if (existing) return answerExisting(existing, subId, exceptions, typed);
  }

  if (!(await isSubOnJob(supabase, subId, projectId))) {
    return NextResponse.json({ error: "That job isn't on your list" }, { status: 403 });
  }

  // Dated when he tapped Post, so a late send from the outbox lands on its real day.
  const at = postedAtOrNow(body.postedAt);
  const postedIso = at.toISOString();
  const day = etDate(at) ?? todayET();
  const live = day === todayET();
  const link = await findPhaseLink(supabase, subId, projectId, day);
  const row: Record<string, unknown> = {
    ...(id ? { id } : {}),
    project_id: projectId,
    subcontractor_id: subId,
    author_id: null,
    kind: "post",
    status: "completed",
    text: text || null,
    // A post is a moment: start = end, the same shape as a crew post.
    started_at: postedIso,
    ended_at: postedIso,
  };

  let inserted = await insertPost(supabase, row, link);
  if (inserted.error && link.schedule_phase_id && inserted.error.code !== "23505") {
    // A phase link the schedule triggers refuse must never cost him the post.
    inserted = await insertPost(supabase, row, {});
  }
  if (inserted.error || !inserted.id) {
    if (inserted.error?.code === "23505" && id) {
      // Two tries crossed: the other one created it a moment ago.
      const existing = await findOwnPost(supabase, id, subId);
      if (existing && existing !== "taken") return answerExisting(existing, subId, exceptions, typed);
      return badId(409);
    }
    return NextResponse.json({ error: inserted.error?.message ?? "Couldn't post. Try again." }, { status: 500 });
  }
  const logId = inserted.id;

  // sub_record_visit counts today only, so a late post from an earlier day
  // must not put him on site today (that day's count needs a day-taking RPC).
  if (live) await recordVisit(supabase, { projectId, subId, source: "post", posts: 1 });
  revalidateSchedule(projectId);
  after(() => notifyPosted(subId, projectId, logId, exceptions, typed, live));

  const res: SubPostCreateResponse = { ok: true, logId, created: true };
  return NextResponse.json(res);
}

type ExistingPost = { id: string; project_id: string | null; started_at: string | null };

/** Back-dating limit for a late post: older than this it's dated now (no faking a field record). */
const MAX_LATE_MS = 7 * 86_400_000;
/** Phone clocks drift; two minutes ahead of the server is still "now". */
const CLOCK_SKEW_MS = 2 * 60_000;

/** When he tapped Post. Unreadable, too far ahead or too old falls back to now; never refuses the post. */
function postedAtOrNow(value: unknown): Date {
  const now = new Date();
  if (typeof value !== "string" || !value) return now;
  const tapped = new Date(value);
  const ms = tapped.getTime();
  if (Number.isNaN(ms) || ms > now.getTime() + CLOCK_SKEW_MS || ms < now.getTime() - MAX_LATE_MS) return now;
  return tapped > now ? now : tapped;
}

const badId = (status = 400) =>
  NextResponse.json({ error: "That post can't be saved. Update the app and try again." }, { status });

/** His post with this id; "taken" when the id is someone else's row; null when there's none. */
async function findOwnPost(supabase: SupabaseClient, id: string, subId: string): Promise<ExistingPost | "taken" | null> {
  const { data } = await supabase
    .from("daily_logs")
    .select("id, project_id, subcontractor_id, started_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return data.subcontractor_id === subId
    ? { id: data.id, project_id: data.project_id, started_at: (data.started_at as string | null) ?? null }
    : "taken";
}

async function insertPost(supabase: SupabaseClient, row: Record<string, unknown>, link: PhaseLink) {
  const { data, error } = await supabase
    .from("daily_logs")
    .insert({ ...row, ...link })
    .select("id")
    .single();
  return { id: (data?.id as string | undefined) ?? null, error };
}

/**
 * A retry of a post that's already in. The visit was counted the first time.
 * The per-chip exception notices are keyed on the post, so sending them
 * again only makes sure they exist. The once-a-day sub_field notice is keyed
 * on today, so only a post from today may touch it: a post from an earlier
 * day re-sent late must not push "First post" for a day he hasn't been
 * there (same rule as logs/photo).
 */
function answerExisting(existing: ExistingPost, subId: string, exceptions: SubExceptionChip[], typed: string) {
  const projectId = existing.project_id;
  if (projectId) {
    const fromToday = !!existing.started_at && etDate(existing.started_at) === todayET();
    after(() => notifyPosted(subId, projectId, existing.id, exceptions, typed, fromToday));
  }
  const res: SubPostCreateResponse = { ok: true, logId: existing.id, created: false };
  return NextResponse.json(res);
}

async function notifyPosted(
  subId: string,
  projectId: string,
  logId: string,
  exceptions: SubExceptionChip[],
  typed: string,
  /** The post is from today, so today's sub_field notice may be opened or updated. */
  field = true,
) {
  await Promise.all([
    ...(field ? [notifySubField({ subId, projectId, event: "posted" })] : []),
    ...exceptions.map((kind) => notifySubException({ subId, projectId, logId, kind, text: typed })),
  ]);
}
