"use server";

import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { listRecentDailyLogs, type FeedDailyLog } from "@/lib/actions/daily-logs";
import { isInternalJob } from "@/lib/crew/crew-visibility";

const projectIdSchema = z.string().uuid();

/** A daily-log photo on a job, unsigned — the folder signs what's on screen. */
export type CrewJobPhoto = {
  path: string;
  taken_at: string;
  author_name: string | null;
};

/** Signed-in team member, and (for the crew) a real jobsite, not Office/Shop. */
async function canOpenJob(projectId: string): Promise<boolean> {
  if (!projectIdSchema.safeParse(projectId).success) return false;
  const user = await getUser();
  if (!user?.profile) return false;
  if (user.profile.role !== "field") return true;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name, project_number, is_overhead")
    .eq("id", projectId)
    .maybeSingle();
  return !!project && !isInternalJob(project);
}

/**
 * Every crew member's daily logs on one job, newest first. Photos come back
 * unsigned (useSignedLogPhotos fills them in) so a busy job opens instantly.
 */
export async function getCrewJobLogs(projectId: string, limit = 20): Promise<FeedDailyLog[]> {
  if (!(await canOpenJob(projectId))) return [];
  const capped = Math.min(Math.max(1, Math.floor(limit)), 200);
  return listRecentDailyLogs(capped, projectId, { signPhotos: false });
}

/** All daily-log photos taken on one job, newest first. */
export async function getCrewJobPhotos(projectId: string): Promise<CrewJobPhoto[]> {
  if (!(await canOpenJob(projectId))) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("daily_logs")
    .select("started_at, photo_storage_paths, author:profiles!author_id(full_name)")
    .eq("project_id", projectId)
    .not("photo_storage_paths", "eq", "{}")
    .order("started_at", { ascending: false })
    .limit(500);

  const out: CrewJobPhoto[] = [];
  for (const row of data ?? []) {
    const author = Array.isArray(row.author) ? row.author[0] : row.author;
    for (const path of (row.photo_storage_paths ?? []) as string[]) {
      if (path) out.push({ path, taken_at: row.started_at, author_name: author?.full_name ?? null });
    }
  }
  return out;
}
