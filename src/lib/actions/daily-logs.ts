"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { revalidatePath } from "next/cache";

export type DailyLogStatus = "in_progress" | "completed";

export type DailyLogRow = {
  id: string;
  schedule_phase_id: string;
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
};

export type TodayPhase = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  project_id: string;
  project_name: string;
  project_address: string | null;
  line_item_description: string | null;
  open_log_id: string | null;
  open_log_started_at: string | null;
};

const PHOTO_BUCKET = "daily-log-photos";

/** All schedule_phases active today, with the current user's open log for each (if any). */
export async function getTodayPhases(): Promise<TodayPhase[]> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;

  const today = new Date().toISOString().slice(0, 10);

  const { data: phases } = await supabase
    .from("schedule_phases")
    .select(
      "id, name, start_date, end_date, status, project_id, estimate_line_item_id, projects:project_id(name, address), line_item:estimate_line_items!estimate_line_item_id(description)",
    )
    .lte("start_date", today)
    .gte("end_date", today)
    .order("start_date", { ascending: true });

  if (!phases || phases.length === 0) return [];

  const phaseIds = phases.map((p) => p.id);
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return phases.map((p: any) => {
    const project = Array.isArray(p.projects) ? p.projects[0] : p.projects;
    const lineItem = Array.isArray(p.line_item) ? p.line_item[0] : p.line_item;
    const open = openByPhase.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.name,
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
      project_id: p.project_id,
      project_name: project?.name ?? "Project",
      project_address: project?.address ?? null,
      line_item_description: lineItem?.description ?? null,
      open_log_id: open?.id ?? null,
      open_log_started_at: open?.started_at ?? null,
    };
  });
}

/** Clock in: insert a new in_progress daily_log for the current user on this phase. */
export async function clockInOnPhase(phaseId: string): Promise<{ logId?: string; error?: string }> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };

  // Bail if the user already has an open log on this phase
  const { data: existing } = await supabase
    .from("daily_logs")
    .select("id")
    .eq("author_id", userId)
    .eq("schedule_phase_id", phaseId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (existing) {
    revalidatePath("/command-center");
    return { logId: existing.id };
  }

  const { data, error } = await supabase
    .from("daily_logs")
    .insert({
      schedule_phase_id: phaseId,
      author_id: userId,
      status: "in_progress",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/command-center");
  return { logId: data.id };
}

/** Clock out + finalize the daily log with text and photo storage paths. */
export async function clockOutWithLog(
  logId: string,
  text: string,
  photoStoragePaths: string[],
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };

  const { error } = await supabase
    .from("daily_logs")
    .update({
      text: text || null,
      photo_storage_paths: photoStoragePaths,
      status: "completed",
      ended_at: new Date().toISOString(),
    })
    .eq("id", logId)
    .eq("author_id", userId);

  if (error) return { error: error.message };
  revalidatePath("/command-center");
  return { ok: true };
}

/** Recent daily logs (any author) for the feed, with author + phase + project + signed photo URLs. */
export async function listRecentDailyLogs(limit = 12, projectId?: string): Promise<FeedDailyLog[]> {
  const supabase = await createClient();

  let phaseIds: string[] | null = null;
  if (projectId) {
    const { data: phases } = await supabase
      .from("schedule_phases")
      .select("id")
      .eq("project_id", projectId);
    phaseIds = (phases ?? []).map((p) => p.id);
    if (phaseIds.length === 0) return [];
  }

  let query = supabase
    .from("daily_logs")
    .select(
      `
      id, schedule_phase_id, author_id, text, photo_storage_paths, status, started_at, ended_at,
      author:profiles!author_id(full_name, email),
      phase:schedule_phases!schedule_phase_id(
        name,
        project_id,
        projects:project_id(name),
        line_item:estimate_line_items!estimate_line_item_id(description)
      )
    `,
    )
    .order("started_at", { ascending: false })
    .limit(limit);

  if (phaseIds) query = query.in("schedule_phase_id", phaseIds);

  const { data: rows } = await query;

  if (!rows || rows.length === 0) return [];

  const allPaths = rows.flatMap((r) => r.photo_storage_paths ?? []);
  const signedMap = new Map<string, string>();
  if (allPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(allPaths, 60 * 60);
    (signed ?? []).forEach((s) => {
      if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => {
    const author = Array.isArray(r.author) ? r.author[0] : r.author;
    const phase = Array.isArray(r.phase) ? r.phase[0] : r.phase;
    const project = phase ? (Array.isArray(phase.projects) ? phase.projects[0] : phase.projects) : null;
    const lineItem = phase ? (Array.isArray(phase.line_item) ? phase.line_item[0] : phase.line_item) : null;
    const photo_storage_paths: string[] = r.photo_storage_paths ?? [];
    return {
      id: r.id,
      schedule_phase_id: r.schedule_phase_id,
      author_id: r.author_id,
      text: r.text,
      photo_storage_paths,
      status: r.status,
      started_at: r.started_at,
      ended_at: r.ended_at,
      author_name: author?.full_name ?? null,
      author_email: author?.email ?? null,
      phase_name: phase?.name ?? "Phase",
      project_id: phase?.project_id ?? "",
      project_name: project?.name ?? "Project",
      line_item_description: lineItem?.description ?? null,
      photo_signed_urls: photo_storage_paths.map((p) => signedMap.get(p)).filter((u): u is string => !!u),
    };
  });
}

export async function getDailyLogBucket(): Promise<string> {
  return PHOTO_BUCKET;
}
