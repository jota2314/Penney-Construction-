"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { revalidatePath } from "next/cache";
import { MAX_SHIFT_MS } from "@/lib/crew/shift";

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
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;

  const today = new Date().toISOString().slice(0, 10);

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
    .lte("start_date", today)
    .gte("end_date", today)
    .order("start_date", { ascending: true });

  if (employeeId) {
    query = query.contains("assigned_employee_ids", [employeeId]);
  }

  const { data: phases } = await query;

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

/** Clock in: insert a new in_progress daily_log for the current user on this phase. */
export async function clockInOnPhase(phaseId: string): Promise<{ logId?: string; error?: string }> {
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
      return { logId: existing.id };
    }
    return { error: "You're already clocked in. Clock out first." };
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
  revalidatePath("/crew");
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
  revalidatePath("/crew");
  return { ok: true };
}

/**
 * Post a finalised daily log in one shot (no clock-in/out cycle).
 * Used by the schedule card → "Log my work" composer for quick voice
 * notes and photo posts. The log lands as status='completed' so it
 * shows up immediately in the field feed.
 */
export async function postDailyLog(
  phaseId: string,
  text: string,
  photoStoragePaths: string[],
): Promise<{ ok?: true; error?: string; logId?: string }> {
  const supabase = await createClient();
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };
  if (!phaseId) return { error: "Phase is required" };
  const trimmed = (text || "").trim();
  if (!trimmed && photoStoragePaths.length === 0) {
    return { error: "Add a note or a photo before posting" };
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("daily_logs")
    .insert({
      schedule_phase_id: phaseId,
      author_id: userId,
      text: trimmed || null,
      photo_storage_paths: photoStoragePaths,
      status: "completed",
      started_at: now,
      ended_at: now,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/command-center");
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

  const { data: existing, error: readErr } = await supabase
    .from("daily_logs")
    .select("photo_storage_paths")
    .eq("id", logId)
    .eq("author_id", userId)
    .single();
  if (readErr || !existing) return { error: readErr?.message || "Log not found" };

  const current: string[] = Array.isArray(existing.photo_storage_paths) ? existing.photo_storage_paths : [];
  const next = [...current, photoStoragePath];

  const { error } = await supabase
    .from("daily_logs")
    .update({ photo_storage_paths: next })
    .eq("id", logId)
    .eq("author_id", userId);

  if (error) return { error: error.message };
  revalidatePath("/command-center");
  revalidatePath("/crew");
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
    completion_photo_url: string | null;
  }>;
};

export type FeedActivity =
  | (FeedDailyLog & { kind: "daily-log" })
  | FeedPunchGroup;

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

      // Group by punch_session_id (or by row id when missing).
      const groups = new Map<string, FeedPunchGroup>();
      for (const r of rows) {
        const sid = (r.punch_session_id as string | null) || `solo-${r.id}`;
        const m = /^\[(.+?)\]\s*(.*)$/.exec(r.description ?? "");
        const location = m?.[1] ?? null;
        const description = m?.[2] ?? (r.description ?? "");
        const creationPaths = (r.creation_photo_paths ?? []) as string[];
        let creationUrls: string[] = [];
        if (creationPaths.length > 0) {
          const { data: signed } = await supabase.storage
            .from("project-files")
            .createSignedUrls(creationPaths, 3600);
          creationUrls = (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => !!u);
        }
        let completionUrl: string | null = null;
        if (r.completion_photo_path) {
          const { data: signed } = await supabase.storage
            .from("project-files")
            .createSignedUrl(r.completion_photo_path, 3600);
          completionUrl = signed?.signedUrl ?? null;
        }

        const author = r.created_by ? authorMap.get(r.created_by) ?? null : null;
        const itemEntry = {
          id: r.id,
          description,
          location,
          priority: r.priority ?? "medium",
          status: r.status ?? "open",
          assignee: r.assignee,
          photo_signed_urls: creationUrls,
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
  return merged.slice(0, limit);
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

export type WeekSchedulePhase = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  color: string;
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
      id, name, start_date, end_date, status, color, project_id, assigned_employee_ids,
      projects:project_id(name, project_number, address, city, state, latitude, longitude),
      line_item:estimate_line_items!estimate_line_item_id(description)
    `,
    )
    .lte("start_date", weekEnd)
    .gte("end_date", weekStart)
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
      "id, started_at, phase:schedule_phases!schedule_phase_id(name, projects:project_id(name))",
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
};

/** Active jobs a field worker can clock into, optionally filtered by a search term. */
export async function searchActiveJobs(query?: string): Promise<ClockInJob[]> {
  const supabase = await createClient();
  let q = supabase
    .from("projects")
    .select("id, name, project_number, address, city, state")
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

/**
 * Clock into a job that has no scheduled line-item task: spins up a lightweight
 * "General work" phase dated today (assigned to this worker) and clocks in on
 * it, so it lands on the master schedule and on the worker's Today's Work with
 * a working clock-out.
 */
export async function clockInGeneral(
  projectId: string,
): Promise<{ logId?: string; error?: string }> {
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
      name: "General work",
      start_date: today,
      end_date: today,
      status: "in_progress",
      created_by: userId,
      assigned_employee_ids: employee ? [employee.id] : [],
    })
    .select("id")
    .single();
  if (phaseErr || !phase) {
    return { error: phaseErr?.message ?? "Could not start a task for this job" };
  }

  return clockInOnPhase(phase.id);
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
       phase:schedule_phases!schedule_phase_id(name, projects:project_id(name, project_number))`,
    )
    .eq("author_id", userId)
    .gte("started_at", since.toISOString())
    .order("started_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const phase = Array.isArray(r.phase) ? r.phase[0] : r.phase;
    const project = phase ? (Array.isArray(phase.projects) ? phase.projects[0] : phase.projects) : null;
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
