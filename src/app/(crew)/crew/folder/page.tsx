import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getMyClockedInJob } from "@/lib/actions/daily-logs";
import { CrewJobFolder, type FolderJob } from "@/components/crew/crew-job-folder";

// Document categories a field worker sees — mirrors getCrewJobDocuments.
const CREW_DOC_CATEGORIES = ["construction_drawings", "plans", "permits", "specs", "other"];

function todayInBoston(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString()
    .slice(0, 10);
}

/** ISO timestamp for "two weeks ago" — the window for "your jobs". */
function twoWeeksAgoIso(): string {
  return new Date(Date.now() - 14 * 86400000).toISOString();
}

export default async function CrewFolderPage() {
  const user = await requireAuth();
  const userId = user.profile?.id ?? user.id;
  const supabase = await createClient();
  const today = todayInBoston();
  const since = twoWeeksAgoIso();

  const [{ data: jobs }, clockedIn, { data: recentShifts }, { data: employee }, { data: files }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, project_number, address, city, state, zip, latitude, longitude, scope_of_work")
        .in("status", ["contracted", "in_progress"])
        .order("name", { ascending: true }),
      getMyClockedInJob().catch(() => null),
      // Where this worker has clocked in lately — those are "your jobs".
      supabase
        .from("daily_logs")
        .select("project_id, started_at")
        .eq("author_id", userId)
        .eq("kind", "shift")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(300),
      supabase.from("employees").select("id").eq("profile_id", userId).maybeSingle(),
      supabase
        .from("project_files")
        .select("project_id, category")
        .in("category", CREW_DOC_CATEGORIES)
        .limit(3000),
    ]);

  // Today's scheduled task on each job for THIS worker (assigned_employee_ids).
  let todayPhases: { project_id: string; name: string }[] = [];
  if (employee?.id) {
    const { data } = await supabase
      .from("schedule_phases")
      .select("project_id, name")
      .lte("start_date", today)
      .gte("end_date", today)
      .contains("assigned_employee_ids", [employee.id]);
    todayPhases = (data ?? []) as { project_id: string; name: string }[];
  }

  const lastWorked = new Map<string, string>();
  for (const s of recentShifts ?? []) {
    if (s.project_id && !lastWorked.has(s.project_id)) lastWorked.set(s.project_id, s.started_at as string);
  }
  const todayTask = new Map<string, string>();
  for (const p of todayPhases) if (!todayTask.has(p.project_id)) todayTask.set(p.project_id, p.name);
  const docCount = new Map<string, number>();
  for (const f of files ?? []) {
    if (f.project_id) docCount.set(f.project_id, (docCount.get(f.project_id) ?? 0) + 1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: FolderJob[] = ((jobs ?? []) as any[]).map((j) => ({
    id: j.id,
    name: j.name,
    project_number: j.project_number ?? null,
    address: j.address ?? null,
    city: j.city ?? null,
    state: j.state ?? null,
    zip: j.zip ?? null,
    latitude: j.latitude ?? null,
    longitude: j.longitude ?? null,
    scope_of_work: j.scope_of_work ?? null,
    doc_count: docCount.get(j.id) ?? 0,
    last_worked_at: lastWorked.get(j.id) ?? null,
    today_task: todayTask.get(j.id) ?? null,
    clocked_in: clockedIn?.id === j.id,
  }));

  return (
    <div className="px-4 pt-4 pb-8">
      <CrewJobFolder jobs={rows} initialJobId={clockedIn?.id ?? null} />
    </div>
  );
}
