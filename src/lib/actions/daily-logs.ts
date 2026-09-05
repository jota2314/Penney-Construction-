"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { canManageFeed } from "@/lib/auth/feed-permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { crewToday, scheduleDays } from "@/lib/crew/schedule-dates";
import { MAX_SHIFT_MS } from "@/lib/crew/shift";
import { distanceMeters, GEOFENCE_METERS } from "@/lib/crew/geo";
import { notifyTaggedProfiles } from "@/lib/notifications/tagged-mentions";
import {
  isGroupMentionType,
  profileInGroup,
  type GroupMentionType,
} from "@/lib/activity-mentions/groups";
import { signThumbUrls } from "@/lib/image/transform-signed-url";
import { cachedSignedUrls } from "@/lib/storage/signed-url-cache";
import {
  listFeedCommentsForSources,
  type FeedComment,
} from "@/lib/actions/feed-comments";

/** Feed/gallery signed-URL lifetime. Long enough that revisits within the week
 * reuse the browser cache instead of re-downloading every photo. */
const SIGNED_URL_TTL = 60 * 60 * 24 * 7;
/** Rendered width for feed-tile thumbnails (via Supabase image transforms). */
const THUMB_WIDTH = 800;

const dailyLogTagSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "job",
    "worker",
    "subcontractor",
    "everyone",
    "office",
    "field",
  ]),
  label: z.string().trim().min(1).max(160),
  token: z.string().trim().regex(/^[A-Za-z0-9]+$/).max(80),
  profileId: z.string().uuid().nullable(),
});

export type DailyLogTag = z.infer<typeof dailyLogTagSchema>;

export type DailyLogStatus = "in_progress" | "completed";

export type DailyLogRow = {
  id: string;
  schedule_phase_id: string | null;
  project_id: string | null;
  author_id: string;
  text: string | null;
  photo_storage_paths: string[];
  status: DailyLogStatus;
  started_at: string;
  ended_at: string | null;
};

export type FeedDailyLog = DailyLogRow & {
  author_name: string | null;
  author_email: string | null;
  phase_name: string;
  project_id: string;
  project_name: string;
  line_item_description: string | null;
  photo_signed_urls: string[];
  /** Resized (width=800) variants of photo_signed_urls, same order — use for
   * feed tiles; keep photo_signed_urls for the full-screen viewer. */
  photo_thumb_urls: string[];
  comments: FeedComment[];
};

export type ListDailyLogsOptions = {
  /** Mint signed photo URLs up front. Default true. */
  signPhotos?: boolean;
};

/** A photo's signed URLs: the full-size original and the 800px feed tile. */
export type SignedPhoto = { full: string; thumb: string };

/**
 * Mint signed URLs for a set of daily-log photo paths.
 *
 * Split out of listRecentDailyLogs so a page can render immediately with the
 * rows and sign only the photos actually on screen — or let a tab sign its own
 * when the user opens it. Thumbnails cost one Storage POST each (the batch API
 * can't carry a transform), so signing 200+ photos nobody is looking at was
 * adding seconds to a page load.
 */
export async function signDailyLogPhotos(
  paths: string[],
): Promise<Record<string, SignedPhoto>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};

  const supabase = await createClient();
  const [{ data: signed }, thumbs] = await Promise.all([
    cachedSignedUrls(supabase, PHOTO_BUCKET, unique, SIGNED_URL_TTL),
    signThumbUrls(supabase, PHOTO_BUCKET, unique, SIGNED_URL_TTL),
  ]);

  const out: Record<string, SignedPhoto> = {};
  for (const s of signed ?? []) {
    if (!s.path || !s.signedUrl) continue;
    // Fall back to the full-size URL when the resize failed, so a photo never
    // disappears just because the transform didn't sign.
    out[s.path] = { full: s.signedUrl, thumb: thumbs.get(s.path) ?? s.signedUrl };
  }
  return out;
}

export type TodayPhase = {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  start_date: string;
  end_date: string;
  status: string;
  project_id: string;
  project_number: string;
  project_name: string;
  project_type: string | null;
  project_address: string | null;
  project_city: string | null;
  project_state: string | null;
  project_zip: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  line_item_description: string | null;
  line_item_quantity: number | null;
  line_item_unit: string | null;
  line_item_scope: string | null;
  crew: { id: string; first_name: string; last_name: string; title: string | null }[];
  latest_log: {
    author_name: string | null;
    text: string | null;
    started_at: string;
    status: DailyLogStatus;
  } | null;
  open_log_id: string | null;
  open_log_started_at: string | null;
};

const PHOTO_BUCKET = "daily-log-photos";

/**
 * All schedule_phases active today, with the current user's open log for each (if any).
 * If `employeeId` is provided, results are filtered to phases that have that employee
 * id in their assigned_employee_ids array (used by the field-worker /crew view).
 */
export async function getTodayPhases(employeeId?: string): Promise<TodayPhase[]> {
  const today = crewToday();
  return getPhasesInRange(today, today, employeeId);
}

/** Resolve the effective worker on the server, including an authorized View As session. */
export async function getMyUpcomingPhases(): Promise<{ today: string; phases: TodayPhase[] }> {
  const user = await getUser();
  if (!user) throw new Error("Sign in to see your schedule");
  const supabase = await createClient();
  const { data: employee, error } = await supabase.from("employees").select("id")
    .eq("profile_id", user.profile?.id ?? user.id).single();
  if (error || !employee) throw new Error("Employee profile unavailable");
  const today = crewToday();
  return { today, phases: await getPhasesInRange(today, scheduleDays(today).at(-1)!, employee.id) };
}

async function getPhasesInRange(start: string, end: string, employeeId?: string): Promise<TodayPhase[]> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;

  let query = supabase
    .from("schedule_phases")
    .select(
      `
      id, name, description, notes, start_date, end_date, status,
      project_id, estimate_line_item_id, assigned_employee_ids,
      projects:project_id(
        name, project_number, project_type, address, city, state, zip,
        customer:customers!customer_id(first_name, last_name, phone)
      ),
      line_item:estimate_line_items!estimate_line_item_id(description, quantity, unit, scope_text)
    `,
    )
    .lte("start_date", end)
    .gte("end_date", start)
    // Live work only — tentative (unconfirmed) plan items never reach the crew.
    .or("is_confirmed.eq.true,status.in.(in_progress,completed)")
    .order("start_date", { ascending: true });

  if (employeeId) {
    query = query.contains("assigned_employee_ids", [employeeId]);
  }

  const { data: phases, error } = await query;
  if (error) throw new Error("Schedule could not be loaded");

  if (!phases || phases.length === 0) return [];

  const phaseIds = phases.map((p) => p.id);
  // Collect every employee id referenced across all phases (one employees query)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allEmpIds = Array.from(new Set((phases as any[]).flatMap((p) => p.assigned_employee_ids ?? [])));
  const empById = new Map<string, { id: string; first_name: string; last_name: string; title: string | null }>();
  if (allEmpIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, first_name, last_name, title")
      .in("id", allEmpIds);
    (emps ?? []).forEach((e) => empById.set(e.id, e));
  }

  // Open log per phase for the current user (drives the Clock in / Clock out toggle)
  const { data: openLogs } = userId
    ? await supabase
        .from("daily_logs")
        .select("id, schedule_phase_id, started_at")
        .eq("author_id", userId)
        .eq("status", "in_progress")
        .in("schedule_phase_id", phaseIds)
    : { data: [] as { id: string; schedule_phase_id: string; started_at: string }[] };

  const openByPhase = new Map<string, { id: string; started_at: string }>();
  (openLogs ?? []).forEach((l) => openByPhase.set(l.schedule_phase_id, { id: l.id, started_at: l.started_at }));

  // Latest log on each phase (any author) for the "last update" preview
  const { data: latestLogs } = await supabase
    .from("daily_logs")
    .select("schedule_phase_id, text, status, started_at, author:profiles!author_id(full_name, email)")
    .in("schedule_phase_id", phaseIds)
    .order("started_at", { ascending: false });
  const latestByPhase = new Map<string, TodayPhase["latest_log"]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (latestLogs ?? []).forEach((l: any) => {
    if (latestByPhase.has(l.schedule_phase_id)) return;
    const author = Array.isArray(l.author) ? l.author[0] : l.author;
    latestByPhase.set(l.schedule_phase_id, {
      author_name: author?.full_name ?? author?.email?.split("@")[0] ?? null,
      text: l.text,
      started_at: l.started_at,
      status: l.status,
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (phases as any[]).map((p) => {
    const project = Array.isArray(p.projects) ? p.projects[0] : p.projects;
    const customer = project ? (Array.isArray(project.customer) ? project.customer[0] : project.customer) : null;
    const lineItem = Array.isArray(p.line_item) ? p.line_item[0] : p.line_item;
    const open = openByPhase.get(p.id) ?? null;
    const crew = ((p.assigned_employee_ids ?? []) as string[])
      .map((eid) => empById.get(eid))
      .filter((e): e is NonNullable<typeof e> => !!e);

    return {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      notes: p.notes ?? null,
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
      project_id: p.project_id,
      project_number: project?.project_number ?? "",
      project_name: project?.name ?? "Project",
      project_type: project?.project_type ?? null,
      project_address: project?.address ?? null,
      project_city: project?.city ?? null,
      project_state: project?.state ?? null,
      project_zip: project?.zip ?? null,
      customer_name: customer ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() || null : null,
      customer_phone: customer?.phone ?? null,
      line_item_description: lineItem?.description ?? null,
      line_item_quantity: lineItem?.quantity ?? null,
      line_item_unit: lineItem?.unit ?? null,
      line_item_scope: lineItem?.scope_text ?? null,
      crew,
      latest_log: latestByPhase.get(p.id) ?? null,
      open_log_id: open?.id ?? null,
      open_log_started_at: open?.started_at ?? null,
    };
  });
}

export type ClockInLocation = { lat: number; lng: number; accuracy?: number };

export type ClockInResult = {
  logId?: string;
  error?: string;
  /** On-site geofence outcome (null when no location/job pin available). */
  onSite?: boolean | null;
  distanceM?: number | null;
};

/**
 * Clock in: insert a new in_progress daily_log for the current user on this
 * phase. When a location fix is supplied, compares it to the job-site pin and
 * stamps the clock-in coordinates + on-site/off-site flag on the log.
 */
export async function clockInOnPhase(
  phaseId: string,
  loc?: ClockInLocation | null,
): Promise<ClockInResult> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };

  // A worker can only be on one clock at a time. If they already have an open
  // log, hand back the same one when it's this phase (idempotent), otherwise
  // tell them to clock out first.
  const { data: existing } = await supabase
    .from("daily_logs")
    .select("id, schedule_phase_id")
    .eq("author_id", userId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    if (existing.schedule_phase_id === phaseId) {
      revalidatePath("/command-center");
      revalidatePath("/crew");
      revalidatePath("/board");
      return { logId: existing.id };
    }
    return { error: "You're already clocked in. Clock out first." };
  }

  // The phase's project — stamped on the log so it survives schedule edits —
  // plus the job pin for the geofence check (best-effort, never blocks clock-in).
  const { data: phase } = await supabase
    .from("schedule_phases")
    .select("project_id, estimate_line_item_id, projects:project_id(latitude, longitude)")
    .eq("id", phaseId)
    .maybeSingle();
  if (!phase?.project_id) return { error: "This scheduled work is no longer available. Choose the job again." };
  let onSite: boolean | null = null;
  let distanceM: number | null = null;
  if (loc) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const project = phase ? (Array.isArray((phase as any).projects) ? (phase as any).projects[0] : (phase as any).projects) : null;
    if (project?.latitude != null && project?.longitude != null) {
      distanceM = Math.round(distanceMeters(loc.lat, loc.lng, project.latitude, project.longitude));
      onSite = distanceM <= GEOFENCE_METERS;
    }
  }

  const { data, error } = await supabase
    .from("daily_logs")
    .insert({
      schedule_phase_id: phaseId,
      project_id: phase.project_id,
      estimate_line_item_id: phase.estimate_line_item_id ?? null,
      author_id: userId,
      status: "in_progress",
      clock_in_lat: loc?.lat ?? null,
      clock_in_lng: loc?.lng ?? null,
      clock_in_accuracy: loc?.accuracy ?? null,
      clock_in_distance_m: distanceM,
      clock_in_on_site: onSite,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/command-center");
  revalidatePath("/crew");
  revalidatePath("/board");
  return { logId: data.id, onSite, distanceM };
}

/** Clock out + finalize the daily log. Note text and photos are optional —
 *  a plain clock-out passes neither. */
export async function clockOutWithLog(
  logId: string,
  text?: string,
  photoStoragePaths?: string[],
  progress?: { finished: string; remaining: string; blocked: string },
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };

  const update: Record<string, unknown> = {};
  if (text !== undefined) update.text = text || null;
  if (photoStoragePaths !== undefined) update.photo_storage_paths = photoStoragePaths;
  if (progress) {
    const parsed = z.object({ finished: z.string().trim().max(1500), remaining: z.string().trim().max(1500), blocked: z.string().trim().max(1500) }).safeParse(progress);
    if (!parsed.success) return { error: "Keep each update under 1,500 characters." };
    const notes = [["Finished", parsed.data.finished], ["Remaining", parsed.data.remaining], ["Blocked by", parsed.data.blocked]]
      .filter(([, value]) => value).map(([label, value]) => label + ": " + value).join("\n");
    if (notes) {
      const { data: existing, error: readError } = await supabase.from("daily_logs").select("text")
        .eq("id", logId).eq("author_id", userId).eq("status", "in_progress").single();
      if (readError || !existing) return { error: "This shift is no longer open. Refresh your time log." };
      update.text = [existing.text, notes].filter(Boolean).join("\n\n");
    }
  }
  const { data: closed, error } = await supabase
    .from("daily_logs")
    .update({
      ...update,
      status: "completed",
      ended_at: new Date().toISOString(),
    })
    .eq("id", logId)
    .eq("author_id", userId)
    .eq("status", "in_progress")
    .select("id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!closed) return { error: "This shift is already closed or unavailable. Refresh your time log." };
  revalidatePath("/command-center");
  revalidatePath("/crew");
  revalidatePath("/board");
  return { ok: true };
}

/**
 * Post a finalised daily log in one shot (no clock-in/out cycle).
 * Works from just a project ("Post update" on any job — no schedule
 * needed) or from a schedule phase ("Log my work" on a schedule card).
 * The log lands as status='completed' so it shows up immediately in
 * the field feed.
 */
export async function postDailyLog(
  target: { projectId?: string; phaseId?: string | null },
  text: string,
  photoStoragePaths: string[],
  /**
   * Photos the client is about to background-upload onto this log. The row
   * is inserted BEFORE the photos exist, so a photos-only post (no note)
   * must not be rejected as empty.
   */
  pendingPhotoCount = 0,
  tags: DailyLogTag[] = [],
): Promise<{ ok?: true; error?: string; logId?: string }> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };

  const phaseId = target.phaseId ?? null;
  let projectId = target.projectId ?? null;
  if (!phaseId && !projectId) return { error: "Pick a job first" };

  const trimmed = (text || "").trim();
  if (!trimmed && photoStoragePaths.length === 0 && pendingPhotoCount === 0) {
    return { error: "Add a note or a photo before posting" };
  }
  const parsedTags = z.array(dailyLogTagSchema).max(30).safeParse(tags);
  if (!parsedTags.success) return { error: "One or more tags are invalid" };

  // Stamp the project even when posting against a phase, so the log
  // survives schedule rebuilds.
  if (!projectId && phaseId) {
    const { data: phase } = await supabase
      .from("schedule_phases")
      .select("project_id")
      .eq("id", phaseId)
      .maybeSingle();
    projectId = phase?.project_id ?? null;
  }

  // Group tags (@Everyone / @Office / @Field) are deliberate broadcasts —
  // expand them to the matching profiles (by role) instead of the
  // individually-tagged people. Individual @tags still count on top.
  const groupTypes = Array.from(
    new Set(parsedTags.data.map((tag) => tag.type).filter(isGroupMentionType)),
  ) as GroupMentionType[];
  const wantsGroups = groupTypes.length > 0;
  const requestedProfileIds = Array.from(
    new Set(
      parsedTags.data
        .map((tag) => tag.profileId)
        .filter((id): id is string => Boolean(id) && id !== userId),
    ),
  );
  const [{ data: candidateProfiles }, { data: project }] = await Promise.all([
    wantsGroups
      ? supabase.from("profiles").select("id, role")
      : requestedProfileIds.length > 0
        ? supabase.from("profiles").select("id, role").in("id", requestedProfileIds)
        : Promise.resolve({ data: [] as { id: string; role: string | null }[] }),
    projectId
      ? supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null as { id: string; name: string } | null }),
  ]);
  const requestedSet = new Set(requestedProfileIds);
  const validatedProfileIds = (candidateProfiles ?? [])
    .filter((profile) =>
      wantsGroups
        ? groupTypes.some((group) => profileInGroup(group, profile.role)) ||
          requestedSet.has(profile.id)
        : true,
    )
    .map((profile) => profile.id)
    .filter((id) => id !== userId);
  const storedTags = parsedTags.data.map(({ id, type, label, token }) => ({
    id,
    type,
    label,
    token,
  }));

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("daily_logs")
    .insert({
      schedule_phase_id: phaseId,
      project_id: projectId,
      author_id: userId,
      text: trimmed || null,
      photo_storage_paths: photoStoragePaths,
      tagged_entities: storedTags,
      mentioned_profile_ids: validatedProfileIds,
      status: "completed",
      started_at: now,
      ended_at: now,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  // Only the explicitly @tagged teammates get pinged (in-app + push + email).
  // A daily log with no tags notifies no one — the whole team is not spammed.
  const authorName =
    user?.profile?.full_name ?? user?.email?.split("@")[0] ?? "A teammate";
  await notifyTaggedProfiles({
    actorId: userId,
    actorName: authorName,
    recipientProfileIds: validatedProfileIds,
    sourceType: "daily_log",
    sourceId: data.id,
    title: wantsGroups
      ? `${authorName} posted a field update`
      : `${authorName} tagged you in a daily log`,
    body: `${project?.name ?? "Daily log"}: ${trimmed || "Shared photos"}`,
    url: projectId ? `/projects/${projectId}` : "/command-center",
  }).catch((err) => {
    console.error("Failed to send daily log notifications", {
      logId: data.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  revalidatePath("/command-center");
  revalidatePath("/crew");
  revalidatePath("/board");
  return { ok: true, logId: data?.id };
}

/**
 * Fetch recent punch-list groups for a single project. Same data
 * shape as listRecentFieldActivity but punch-only and project-scoped,
 * used by the schedule popup to keep existing punch lists visible
 * after a new one is saved.
 */
export async function listRecentProjectPunchGroups(projectId: string, limit = 4): Promise<FeedPunchGroup[]> {
  const all = await listRecentFieldActivity(limit * 4, projectId);
  return all.filter((row): row is FeedPunchGroup => row.kind === "punch-group").slice(0, limit);
}

/**
 * Open todos for a project — used by the schedule card detail sheet to
 * show "what still needs doing on this job today".
 */
export async function listProjectOpenTodos(projectId: string): Promise<
  Array<{ id: string; description: string; priority: string | null; due_date: string | null }>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("todos")
    .select("id, description, priority, due_date")
    .eq("project_id", projectId)
    .eq("status", "open")
    .order("priority", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(20);
  return data ?? [];
}

/**
 * Append a single photo path to a daily_log's photo_storage_paths
 * column. Used by the background-upload path in the composer so the UI
 * can dismiss immediately after posting and let photos finish uploading
 * one at a time, each appended as it completes.
 */
export async function appendDailyLogPhoto(
  logId: string,
  photoStoragePath: string
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };

  // Atomic array_append under the row lock (append_daily_log_photo SQL fn) —
  // parallel uploads used to read-modify-write this column and lose photos.
  const { data: appended, error } = await supabase.rpc("append_daily_log_photo", {
    p_log_id: logId,
    p_path: photoStoragePath,
  });

  if (error) return { error: error.message };
  if (!appended) return { error: "Log not found" };
  revalidatePath("/command-center");
  revalidatePath("/crew");
  revalidatePath("/board");
  return { ok: true };
}

/**
 * Punch-list group rendered as a single feed post — a checklist of
 * items created together (sharing punch_session_id). Each item can be
 * checked off / edited inline directly from the feed.
 */
export type FeedPunchGroup = {
  kind: "punch-group";
  session_id: string;
  project_id: string | null;
  project_name: string;
  author_id: string | null;
  author_name: string | null;
  author_email: string | null;
  created_at: string;
  items: Array<{
    id: string;
    description: string;
    location: string | null;
    priority: string;
    status: string;
    assignee: string | null;
    photo_signed_urls: string[];
    /** Resized (width=800) variants of photo_signed_urls, same order. */
    photo_thumb_urls: string[];
    completion_photo_url: string | null;
  }>;
};

export type FeedActivity =
  | (FeedDailyLog & { kind: "daily-log" })
  | FeedPunchGroup;

/**
 * Delete a daily log (managers only — Jorge + Ryan). Also removes its photos
 * and comment thread. Admin client, after an explicit permission check.
 */
export async function deleteDailyLog(
  logId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.string().uuid().safeParse(logId);
  if (!parsed.success) return { ok: false, error: "Invalid daily log." };

  const user = await getUser();
  if (!canManageFeed(user?.email)) {
    return { ok: false, error: "You don't have permission to delete this." };
  }

  const admin = createAdminClient();

  const { data: log } = await admin
    .from("daily_logs")
    .select("photo_storage_paths")
    .eq("id", parsed.data)
    .maybeSingle();

  const photoPaths = Array.isArray(log?.photo_storage_paths)
    ? (log!.photo_storage_paths as unknown[]).filter(
        (p): p is string => typeof p === "string",
      )
    : [];
  if (photoPaths.length > 0) {
    await admin.storage.from("project-files").remove(photoPaths).catch(() => {});
  }

  await admin
    .from("feed_comments")
    .delete()
    .eq("source_type", "daily_log")
    .eq("source_id", parsed.data);

  const { error } = await admin
    .from("daily_logs")
    .delete()
    .eq("id", parsed.data);

  if (error) {
    console.error("Failed to delete daily log", {
      logId: parsed.data,
      error: error.message,
    });
    return { ok: false, error: "Could not delete the daily log. Try again." };
  }

  revalidatePath("/command-center");
  revalidatePath("/crew");
  revalidatePath("/board");
  return { ok: true };
}

/**
 * Unified field-feed: daily logs + punch-list groups, sorted by
 * most-recent activity. Punch-list rows that share a punch_session_id
 * collapse into one FeedPunchGroup with a checklist of items. Rows
 * without a session_id (legacy/ad-hoc) become 1-item groups.
 */
export async function listRecentFieldActivity(limit = 24, projectId?: string): Promise<FeedActivity[]> {
  const supabase = await createClient();

  const [logs, punchGroups] = await Promise.all([
    listRecentDailyLogs(limit, projectId),
    (async (): Promise<FeedPunchGroup[]> => {
      let q = supabase
        .from("todos")
        .select(
          "id, description, priority, status, project_id, project_name, assignee, created_by, created_at, due_date, completion_photo_path, creation_photo_paths, punch_session_id"
        )
        .eq("category", "punch_list")
        .order("created_at", { ascending: false })
        .limit(limit * 4);
      if (projectId) q = q.eq("project_id", projectId);
      const { data: rows } = await q;
      if (!rows || rows.length === 0) return [];

      const authorIds = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean) as string[]));
      const authorMap = new Map<string, { full_name: string | null; email: string | null }>();
      if (authorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", authorIds);
        (profiles ?? []).forEach((p) => authorMap.set(p.id, { full_name: p.full_name, email: p.email }));
      }

      // Sign every photo across every row in ONE batch up front. This used
      // to run per-row inside the loop — up to `limit * 4` sequential Storage
      // API round-trips on the Command Center home page.
      const allCreationPaths: string[] = [];
      const allCompletionPaths: string[] = [];
      for (const r of rows) {
        for (const p of (r.creation_photo_paths ?? []) as string[]) allCreationPaths.push(p);
        if (r.completion_photo_path) allCompletionPaths.push(r.completion_photo_path);
      }
      const allPaths = [...allCreationPaths, ...allCompletionPaths];
      const signedByPath = new Map<string, string>();
      let thumbsByPath = new Map<string, string>();
      if (allPaths.length > 0) {
        const [{ data: signed }, thumbs] = await Promise.all([
          cachedSignedUrls(supabase, "project-files", allPaths, SIGNED_URL_TTL),
          signThumbUrls(supabase, "project-files", allCreationPaths, SIGNED_URL_TTL),
        ]);
        (signed ?? []).forEach((s) => {
          if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
        });
        thumbsByPath = thumbs;
      }

      // Group by punch_session_id (or by row id when missing).
      const groups = new Map<string, FeedPunchGroup>();
      for (const r of rows) {
        const sid = (r.punch_session_id as string | null) || `solo-${r.id}`;
        const m = /^\[(.+?)\]\s*(.*)$/.exec(r.description ?? "");
        const location = m?.[1] ?? null;
        const description = m?.[2] ?? (r.description ?? "");
        const creationPaths = (r.creation_photo_paths ?? []) as string[];
        const creationUrls = creationPaths
          .map((p) => signedByPath.get(p))
          .filter((u): u is string => !!u);
        const creationThumbs = creationPaths
          .map((p) => thumbsByPath.get(p) ?? signedByPath.get(p))
          .filter((u): u is string => !!u);
        const completionUrl = r.completion_photo_path
          ? signedByPath.get(r.completion_photo_path) ?? null
          : null;

        const author = r.created_by ? authorMap.get(r.created_by) ?? null : null;
        const itemEntry = {
          id: r.id,
          description,
          location,
          priority: r.priority ?? "medium",
          status: r.status ?? "open",
          assignee: r.assignee,
          photo_signed_urls: creationUrls,
          photo_thumb_urls: creationThumbs,
          completion_photo_url: completionUrl,
        };

        const existing = groups.get(sid);
        if (existing) {
          existing.items.push(itemEntry);
          // Keep the earliest created_at as the group timestamp.
          if (new Date(r.created_at).getTime() < new Date(existing.created_at).getTime()) {
            existing.created_at = r.created_at;
          }
        } else {
          groups.set(sid, {
            kind: "punch-group",
            session_id: sid,
            project_id: r.project_id,
            project_name: r.project_name ?? "Project",
            author_id: r.created_by,
            author_name: author?.full_name ?? null,
            author_email: author?.email ?? null,
            created_at: r.created_at,
            items: [itemEntry],
          });
        }
      }
      return Array.from(groups.values());
    })(),
  ]);

  const merged: FeedActivity[] = [
    ...logs.map((l) => ({ ...l, kind: "daily-log" as const })),
    ...punchGroups,
  ];
  merged.sort((a, b) => {
    const ta = new Date(a.kind === "daily-log" ? a.started_at : a.created_at).getTime();
    const tb = new Date(b.kind === "daily-log" ? b.started_at : b.created_at).getTime();
    return tb - ta;
  });
  // Punch lists with unfinished items are working checklists, not transient
  // posts — keep them in the feed even when newer daily logs would push them
  // past the limit. merged is sorted newest-first, so appending the rescued
  // (older) groups preserves that order.
  const top = merged.slice(0, limit);
  const openPunchBeyondLimit = merged
    .slice(limit)
    .filter(
      (a): a is FeedPunchGroup =>
        a.kind === "punch-group" && a.items.some((it) => it.status !== "done"),
    );
  return [...top, ...openPunchBeyondLimit];
}

/** Recent daily logs (any author) for the feed, with author + phase + project + signed photo URLs. */
export async function listRecentDailyLogs(
  limit = 12,
  projectId?: string,
  opts: ListDailyLogsOptions = {},
): Promise<FeedDailyLog[]> {
  const supabase = await createClient();
  // Signing photos is the single most expensive thing this function does: the
  // Storage API can't batch a transform, so thumbnails are minted one POST at
  // a time (see signThumbUrls). A caller that only needs the log rows — or
  // that will sign a small visible subset itself — passes signPhotos: false
  // and gets `photo_signed_urls`/`photo_thumb_urls` empty with the paths
  // intact, then fills them in later via signDailyLogPhotos().
  const signPhotos = opts.signPhotos !== false;

  let query = supabase
    .from("daily_logs")
    .select(
      `
      id, schedule_phase_id, project_id, author_id, subcontractor_id, text, photo_storage_paths, status, started_at, ended_at,
      author:profiles!author_id(full_name, email),
      sub:subcontractors!subcontractor_id(company_name, contact_name),
      project:projects!project_id(name),
      phase:schedule_phases!schedule_phase_id(
        name,
        project_id,
        projects:project_id(name),
        line_item:estimate_line_items!estimate_line_item_id(description)
      )
    `,
    )
    .order("started_at", { ascending: false })
    // Over-fetch: bare clock-outs (no note, no photos) are dropped below.
    .limit(limit * 3);

  if (projectId) query = query.eq("project_id", projectId);

  const { data: allRows } = await query;

  // A plain clock-out (no note, no photos) is a time record, not a feed post —
  // keep it out of the social feed. Live "clocked in" cards still show.
  const rows = (allRows ?? [])
    .filter(
      (r) =>
        r.status === "in_progress" ||
        !!r.text?.trim() ||
        (r.photo_storage_paths?.length ?? 0) > 0,
    )
    .slice(0, limit);

  if (rows.length === 0) return [];

  const commentsByLog = new Map<string, FeedComment[]>();
  const allComments = await listFeedCommentsForSources(
    "daily_log",
    rows.map((r) => r.id),
  ).catch(() => [] as FeedComment[]);
  for (const comment of allComments) {
    const list = commentsByLog.get(comment.sourceId) ?? [];
    list.push(comment);
    commentsByLog.set(comment.sourceId, list);
  }

  const allPaths = rows.flatMap((r) => r.photo_storage_paths ?? []);
  const signedMap = new Map<string, string>();
  let thumbMap = new Map<string, string>();
  if (signPhotos && allPaths.length > 0) {
    const [{ data: signed }, thumbs] = await Promise.all([
      cachedSignedUrls(supabase, PHOTO_BUCKET, allPaths, SIGNED_URL_TTL),
      signThumbUrls(supabase, PHOTO_BUCKET, allPaths, SIGNED_URL_TTL),
    ]);
    (signed ?? []).forEach((s) => {
      if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
    });
    thumbMap = thumbs;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => {
    const author = Array.isArray(r.author) ? r.author[0] : r.author;
    // Sub-portal posts have no profile behind them — show the company instead.
    const sub = Array.isArray(r.sub) ? r.sub[0] : r.sub;
    const phase = Array.isArray(r.phase) ? r.phase[0] : r.phase;
    const directProject = Array.isArray(r.project) ? r.project[0] : r.project;
    const phaseProject = phase ? (Array.isArray(phase.projects) ? phase.projects[0] : phase.projects) : null;
    const lineItem = phase ? (Array.isArray(phase.line_item) ? phase.line_item[0] : phase.line_item) : null;
    const photo_storage_paths: string[] = r.photo_storage_paths ?? [];
    const photo_signed_urls = photo_storage_paths
      .map((p) => signedMap.get(p))
      .filter((u): u is string => !!u);
    return {
      id: r.id,
      schedule_phase_id: r.schedule_phase_id,
      project_id: r.project_id ?? phase?.project_id ?? "",
      // Sub posts carry no profile — reuse the sub's id so avatar colors stay
      // stable and callers keep a non-null id.
      author_id: r.author_id ?? r.subcontractor_id ?? "",
      text: r.text,
      photo_storage_paths,
      status: r.status,
      started_at: r.started_at,
      ended_at: r.ended_at,
      author_name:
        author?.full_name ??
        (sub ? `${sub.contact_name ? `${sub.contact_name} — ` : ""}${sub.company_name}` : null),
      author_email: author?.email ?? null,
      phase_name: phase?.name ?? "Daily update",
      project_name: directProject?.name ?? phaseProject?.name ?? "Project",
      line_item_description: lineItem?.description ?? null,
      photo_signed_urls,
      // Fall back to the full-size URL for any path whose thumbnail failed to
      // sign, so a photo never disappears just because the resize did.
      photo_thumb_urls: photo_storage_paths
        .map((p) => thumbMap.get(p) ?? signedMap.get(p))
        .filter((u): u is string => !!u),
      comments: commentsByLog.get(r.id) ?? [],
    };
  });
}

export async function getDailyLogBucket(): Promise<string> {
  return PHOTO_BUCKET;
}

export type WeekSchedulePhase = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  color: string;
  is_confirmed?: boolean;
  confirmed_with?: string | null;
  project_id: string;
  project_name: string;
  project_number: string;
  project_address: string | null;
  project_city: string | null;
  project_state: string | null;
  project_lat: number | null;
  project_lng: number | null;
  line_item_description: string | null;
  crew: { id: string; first_name: string; last_name: string }[];
};

/**
 * Schedule phases overlapping an 8-week window starting at the current Monday
 * (America/New_York). Used by the manager-side ScheduleStrip on
 * /command-center — gives Jorge ~2 months of forward visibility so the day
 * strip can scroll horizontally without running out of dates.
 */
export async function getWeekSchedule(): Promise<{
  weekStart: string;
  weekEnd: string;
  phases: WeekSchedulePhase[];
  myEmployeeIds: string[];
}> {
  const supabase = await createClient();
  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id ?? null;

  const TZ = "America/New_York";
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const startOfToday = new Date(nowET);
  startOfToday.setHours(0, 0, 0, 0);
  const monday = new Date(startOfToday);
  monday.setDate(startOfToday.getDate() - ((startOfToday.getDay() + 6) % 7));
  const windowEnd = new Date(monday);
  windowEnd.setDate(monday.getDate() + 7 * 8 - 1); // 8 weeks, inclusive

  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const weekStart = isoDate(monday);
  const weekEnd = isoDate(windowEnd);

  // My employee row(s), so the UI can filter to phases I'm on.
  let myEmployeeIds: string[] = [];
  if (profileId) {
    const { data: myEmps } = await supabase
      .from("employees")
      .select("id")
      .eq("profile_id", profileId);
    myEmployeeIds = (myEmps ?? []).map((e) => e.id);
  }

  const { data: phases } = await supabase
    .from("schedule_phases")
    .select(
      `
      id, name, start_date, end_date, status, color, is_confirmed, confirmed_with, project_id, assigned_employee_ids,
      projects:project_id(name, project_number, address, city, state, latitude, longitude),
      line_item:estimate_line_items!estimate_line_item_id(description)
    `,
    )
    .lte("start_date", weekEnd)
    .gte("end_date", weekStart)
    // Live work only — tentative plan items stay on the project's master schedule.
    .or("is_confirmed.eq.true,status.in.(in_progress,completed)")
    .order("start_date", { ascending: true });

  if (!phases || phases.length === 0) {
    return { weekStart, weekEnd, phases: [], myEmployeeIds };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allEmpIds = Array.from(new Set((phases as any[]).flatMap((p) => p.assigned_employee_ids ?? [])));
  const empById = new Map<string, { id: string; first_name: string; last_name: string }>();
  if (allEmpIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", allEmpIds);
    (emps ?? []).forEach((e) => empById.set(e.id, e));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: WeekSchedulePhase[] = (phases as any[]).map((p) => {
    const project = Array.isArray(p.projects) ? p.projects[0] : p.projects;
    const lineItem = Array.isArray(p.line_item) ? p.line_item[0] : p.line_item;
    const crew = ((p.assigned_employee_ids ?? []) as string[])
      .map((eid) => empById.get(eid))
      .filter((e): e is NonNullable<typeof e> => !!e);
    return {
      id: p.id,
      name: p.name,
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
      color: p.color ?? "#3b82f6",
      project_id: p.project_id,
      project_name: project?.name ?? "Project",
      project_number: project?.project_number ?? "",
      project_address: project?.address ?? null,
      project_city: project?.city ?? null,
      project_state: project?.state ?? null,
      project_lat: project?.latitude ?? null,
      project_lng: project?.longitude ?? null,
      line_item_description: lineItem?.description ?? null,
      is_confirmed: p.is_confirmed ?? false,
      confirmed_with: p.confirmed_with ?? null,
      crew,
    };
  });

  return { weekStart, weekEnd, phases: result, myEmployeeIds };
}

export type HoursSummary = {
  todayMinutes: number;
  weekMinutes: number;
  openLog: {
    id: string;
    startedAt: string;
    project_name: string | null;
    phase_name: string | null;
    // Job-site coordinates for the on-site/geofence check (null if the project
    // has no location set yet).
    jobLat: number | null;
    jobLng: number | null;
    // True once the open shift has passed the 12h max — the live ticker is
    // frozen at the cap and the hourly cron will close it automatically.
    cappedAtMaxHours: boolean;
  } | null;
};

/**
 * Today's + this-week's logged minutes for the current user (or the impersonated
 * user when impersonation is active), plus the open-log info for a live ticker.
 * Boundaries are computed in America/New_York.
 */
export async function getMyHoursSummary(): Promise<HoursSummary> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { todayMinutes: 0, weekMinutes: 0, openLog: null };

  const TZ = "America/New_York";
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const startOfToday = new Date(nowET);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  // Monday as week start
  startOfWeek.setDate(startOfToday.getDate() - ((startOfToday.getDay() + 6) % 7));

  const { data: completed } = await supabase
    .from("daily_logs")
    .select("started_at, ended_at")
    .eq("author_id", userId)
    .eq("status", "completed")
    .gte("started_at", startOfWeek.toISOString());

  let todayMinutes = 0;
  let weekMinutes = 0;
  for (const l of completed ?? []) {
    if (!l.ended_at) continue;
    const start = new Date(l.started_at);
    const end = new Date(l.ended_at);
    const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    weekMinutes += mins;
    if (start >= startOfToday) todayMinutes += mins;
  }

  const { data: open } = await supabase
    .from("daily_logs")
    .select(
      "id, started_at, phase:schedule_phases!schedule_phase_id(name, projects:project_id(name, latitude, longitude))",
    )
    .eq("author_id", userId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let openLog: HoursSummary["openLog"] = null;
  if (open) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phase = Array.isArray((open as any).phase) ? (open as any).phase[0] : (open as any).phase;
    const project = phase ? (Array.isArray(phase.projects) ? phase.projects[0] : phase.projects) : null;
    openLog = {
      id: open.id,
      startedAt: open.started_at,
      project_name: project?.name ?? null,
      phase_name: phase?.name ?? null,
      jobLat: project?.latitude ?? null,
      jobLng: project?.longitude ?? null,
      cappedAtMaxHours: Date.now() - new Date(open.started_at).getTime() >= MAX_SHIFT_MS,
    };
  }

  return { todayMinutes, weekMinutes, openLog };
}

// ───────────────────────────────────────────────────────────────────────────
// BuilderTrend-style "search any job → pick the line-item task → clock in"
// ───────────────────────────────────────────────────────────────────────────

export type ClockInJob = {
  id: string;
  name: string;
  project_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** Active jobs a field worker can clock into, optionally filtered by a search term. */
export async function searchActiveJobs(query?: string): Promise<ClockInJob[]> {
  const supabase = await createClient();
  let q = supabase
    .from("projects")
    .select("id, name, project_number, address, city, state, latitude, longitude")
    .in("status", ["contracted", "in_progress"])
    .order("name", { ascending: true })
    .limit(50);

  // Strip characters that would break a PostgREST or() filter, then match
  // across name / number / address / city.
  const term = (query ?? "").replace(/[,()]/g, " ").trim();
  if (term) {
    q = q.or(
      `name.ilike.%${term}%,project_number.ilike.%${term}%,address.ilike.%${term}%,city.ilike.%${term}%`,
    );
  }

  const { data } = await q;
  return data ?? [];
}

/**
 * The job the current user is clocked into right now (open shift), shaped as a
 * ClockInJob so the post-update composer can default to it. Clock-ins stamp
 * project_id on the log; older logs fall back to the phase's project. Null when
 * off the clock.
 */
export async function getMyClockedInJob(): Promise<ClockInJob | null> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return null;

  const { data: open } = await supabase
    .from("daily_logs")
    .select(
      "project:projects!project_id(id, name, project_number, address, city, state, latitude, longitude)," +
        "phase:schedule_phases!schedule_phase_id(project:projects!project_id(id, name, project_number, address, city, state, latitude, longitude))",
    )
    .eq("author_id", userId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!open) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const direct = Array.isArray((open as any).project) ? (open as any).project[0] : (open as any).project;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phase = Array.isArray((open as any).phase) ? (open as any).phase[0] : (open as any).phase;
  const viaPhase = phase ? (Array.isArray(phase.project) ? phase.project[0] : phase.project) : null;
  const project = direct ?? viaPhase;
  if (!project) return null;

  return {
    id: project.id,
    name: project.name,
    project_number: project.project_number ?? "",
    address: project.address ?? null,
    city: project.city ?? null,
    state: project.state ?? null,
    latitude: project.latitude ?? null,
    longitude: project.longitude ?? null,
  };
}

export type JobPhaseOption = {
  id: string;
  name: string;
  line_item_description: string | null;
  start_date: string;
  end_date: string;
  status: string;
  is_today: boolean;
};

/**
 * The master-schedule phases for a job — each carries its estimate line item,
 * so the worker picks the actual task they're doing. Today's tasks sort first.
 */
export async function getJobPhases(projectId: string): Promise<JobPhaseOption[]> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from("schedule_phases")
    .select(
      "id, name, start_date, end_date, status, line_item:estimate_line_items!estimate_line_item_id(description)",
    )
    .eq("project_id", projectId)
    .order("start_date", { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: JobPhaseOption[] = (data ?? []).map((p: any) => {
    const li = Array.isArray(p.line_item) ? p.line_item[0] : p.line_item;
    return {
      id: p.id,
      name: p.name,
      line_item_description: li?.description ?? null,
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
      is_today: p.start_date <= today && p.end_date >= today,
    };
  });
  rows.sort((a, b) =>
    a.is_today === b.is_today ? a.start_date.localeCompare(b.start_date) : a.is_today ? -1 : 1,
  );
  return rows;
}

export type JobLineOption = {
  id: string;
  description: string;
  section: string | null;
  is_change_order: boolean;
  /** A scheduled task for this line covers today. */
  is_today: boolean;
};

/**
 * Budget lines a worker can clock straight into on a job: every open line on
 * the estimate in force (the contract estimate, else the latest version).
 * Closed/locked lines and section headers are left out — the DB guard refuses
 * labor against a locked line anyway. Lines with a task scheduled today sort
 * first, then contract lines in budget order, then change-order lines.
 */
export async function getJobBudgetLines(projectId: string): Promise<JobLineOption[]> {
  const supabase = await createClient();

  const { data: proj } = await supabase
    .from("projects")
    .select("contract_estimate_id")
    .eq("id", projectId)
    .maybeSingle();
  let estimateId: string | null = proj?.contract_estimate_id ?? null;
  if (!estimateId) {
    const { data: est } = await supabase
      .from("estimates")
      .select("id")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    estimateId = est?.id ?? null;
  }
  if (!estimateId) return [];

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: lines }, { data: todayPhases }] = await Promise.all([
    supabase
      .from("estimate_line_items")
      .select("id, description, section, change_order_id, is_section_header, is_locked, sort_order")
      .eq("estimate_id", estimateId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("schedule_phases")
      .select("estimate_line_item_id")
      .eq("project_id", projectId)
      .not("estimate_line_item_id", "is", null)
      .lte("start_date", today)
      .gte("end_date", today),
  ]);

  const todayLines = new Set((todayPhases ?? []).map((p) => p.estimate_line_item_id as string));
  const rows: JobLineOption[] = (lines ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((l: any) => !l.is_section_header && !l.is_locked && (l.description ?? "").trim().length > 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((l: any) => ({
      id: l.id as string,
      description: (l.description as string).trim(),
      section: (l.section as string | null) ?? null,
      is_change_order: !!l.change_order_id,
      is_today: todayLines.has(l.id),
    }));
  rows.sort((a, b) => {
    if (a.is_today !== b.is_today) return a.is_today ? -1 : 1;
    if (a.is_change_order !== b.is_change_order) return a.is_change_order ? 1 : -1;
    return 0; // stable: keeps budget (sort_order) order within each group
  });
  return rows;
}

/**
 * Clock in directly on a budget line. The crew picks the line they are
 * working, not a schedule phase, so the hours are costed to that line from
 * the first minute — no AI routing, no end-of-day write-up needed.
 *
 * Under the hood a schedule phase still carries the shift (that is how
 * getProjectLaborCost, Today's Work, and the master schedule find it): reuse a
 * task already scheduled today for this line, else spin up a one-day phase
 * named after the line. The line is ALSO stamped on the log itself as a manual
 * choice, which outranks the phase link everywhere hours are costed.
 */
export async function clockInOnLineItem(
  projectId: string,
  lineItemId: string,
  loc?: ClockInLocation | null,
): Promise<ClockInResult> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };

  const { data: open } = await supabase
    .from("daily_logs")
    .select("id")
    .eq("author_id", userId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (open) return { error: "You're already clocked in. Clock out first." };

  const { data: line } = await supabase
    .from("estimate_line_items")
    .select("id, description, is_locked, estimate:estimates!estimate_id(project_id)")
    .eq("id", lineItemId)
    .maybeSingle();
  if (!line) return { error: "That budget line is gone. Pick another." };
  if (line.is_locked) {
    return { error: "That budget line is closed. Pick another, or ask the office to reopen it." };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const est = Array.isArray((line as any).estimate) ? (line as any).estimate[0] : (line as any).estimate;
  if (est?.project_id !== projectId) return { error: "That budget line isn't on this job." };

  const today = new Date().toISOString().slice(0, 10);

  // A task already on the schedule for this line today carries the shift.
  const { data: existing } = await supabase
    .from("schedule_phases")
    .select("id")
    .eq("project_id", projectId)
    .eq("estimate_line_item_id", lineItemId)
    .lte("start_date", today)
    .gte("end_date", today)
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  let phaseId = existing?.id ?? null;
  if (!phaseId) {
    const { data: employee } = await supabase
      .from("employees")
      .select("id")
      .eq("profile_id", userId)
      .maybeSingle();
    const { data: phase, error: phaseErr } = await supabase
      .from("schedule_phases")
      .insert({
        project_id: projectId,
        name: (line.description as string).trim().slice(0, 120),
        start_date: today,
        end_date: today,
        status: "in_progress",
        phase_scope: "daily",
        created_by: userId,
        assigned_employee_ids: employee ? [employee.id] : [],
        estimate_line_item_id: lineItemId,
      })
      .select("id")
      .single();
    if (phaseErr || !phase) {
      return { error: phaseErr?.message ?? "Could not start a task for this line" };
    }
    phaseId = phase.id;
  }

  const res = await clockInOnPhase(phaseId, loc);
  if (res.error || !res.logId) return res;

  // The worker's own pick beats any later AI read of the day's write-up.
  await supabase
    .from("daily_logs")
    .update({
      estimate_line_item_id: lineItemId,
      line_item_source: "manual",
      line_item_needs_review: false,
    })
    .eq("id", res.logId)
    .eq("author_id", userId);

  return res;
}

/**
 * Clock into a job that has no scheduled line-item task: spins up a lightweight
 * "Change order work" phase dated today (assigned to this worker) and clocks in
 * on it, so it lands on the master schedule and on the worker's Today's Work
 * with a working clock-out. Off-schedule hours are treated as change-order
 * work, not a generic bucket, so they surface as billable.
 */
export async function clockInGeneral(
  projectId: string,
  loc?: ClockInLocation | null,
): Promise<ClockInResult> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };

  const { data: open } = await supabase
    .from("daily_logs")
    .select("id")
    .eq("author_id", userId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (open) return { error: "You're already clocked in. Clock out first." };

  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("profile_id", userId)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const { data: phase, error: phaseErr } = await supabase
    .from("schedule_phases")
    .insert({
      project_id: projectId,
      name: "Change order work",
      start_date: today,
      end_date: today,
      status: "in_progress",
      phase_scope: "daily",
      created_by: userId,
      assigned_employee_ids: employee ? [employee.id] : [],
    })
    .select("id")
    .single();
  if (phaseErr || !phase) {
    return { error: phaseErr?.message ?? "Could not start a task for this job" };
  }

  return clockInOnPhase(phase.id, loc);
}

/**
 * Record an opportunistic location ping for the current worker's open shift —
 * captured each time they open the app while clocked in (foreground sampling).
 * Computes distance to the job pin and on-site flag. No-op if not clocked in.
 */
export async function recordPresencePing(
  lat: number,
  lng: number,
  accuracy?: number,
): Promise<{ ok?: true; onSite?: boolean | null; distanceM?: number | null; error?: string }> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };

  const { data: open } = await supabase
    .from("daily_logs")
    .select("id, phase:schedule_phases!schedule_phase_id(projects:project_id(latitude, longitude))")
    .eq("author_id", userId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!open) return { ok: true }; // not clocked in — nothing to record

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phase = Array.isArray((open as any).phase) ? (open as any).phase[0] : (open as any).phase;
  const project = phase ? (Array.isArray(phase.projects) ? phase.projects[0] : phase.projects) : null;

  let onSite: boolean | null = null;
  let distanceM: number | null = null;
  if (project?.latitude != null && project?.longitude != null) {
    distanceM = Math.round(distanceMeters(lat, lng, project.latitude, project.longitude));
    onSite = distanceM <= GEOFENCE_METERS;
  }

  const { error } = await supabase.from("daily_log_pings").insert({
    daily_log_id: open.id,
    lat,
    lng,
    accuracy: accuracy ?? null,
    distance_m: distanceM,
    on_site: onSite,
  });
  if (error) return { error: error.message };
  return { ok: true, onSite, distanceM };
}

export type TimeLogEntry = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
  notes: string | null;
  auto_clocked_out: boolean;
  projects: { name: string; project_number: string } | null;
};

/**
 * The current worker's own shifts for the Time Log tab, read from `daily_logs`
 * (the system the field clock actually writes to) and shaped for TimeEntryList.
 */
export async function getMyTimeLog(days = 14): Promise<TimeLogEntry[]> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return [];

  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await supabase
    .from("daily_logs")
    .select(
      `id, started_at, ended_at, status, auto_clocked_out, text,
       project:projects!project_id(name, project_number),
       phase:schedule_phases!schedule_phase_id(name, projects:project_id(name, project_number))`,
    )
    .eq("author_id", userId)
    .gte("started_at", since.toISOString())
    .order("started_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const phase = Array.isArray(r.phase) ? r.phase[0] : r.phase;
    const project =
      (phase ? (Array.isArray(phase.projects) ? phase.projects[0] : phase.projects) : null) ??
      (Array.isArray(r.project) ? r.project[0] : r.project);
    return {
      id: r.id,
      clock_in: r.started_at,
      clock_out: r.ended_at,
      break_minutes: 0,
      notes: r.text ?? null,
      auto_clocked_out: !!r.auto_clocked_out,
      projects: project ? { name: project.name, project_number: project.project_number } : null,
    };
  });
}
