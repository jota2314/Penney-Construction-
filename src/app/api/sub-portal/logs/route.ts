import { NextRequest, NextResponse } from "next/server";
import { resolveSubAccess, getSubProjectIds } from "@/lib/sub-portal/access";
import { signThumbUrls } from "@/lib/image/transform-signed-url";
import { cachedSignedUrls } from "@/lib/storage/signed-url-cache";

export const runtime = "nodejs";
export const maxDuration = 30;

const PHOTO_BUCKET = "daily-log-photos";
const SIGNED_TTL = 60 * 60 * 4;
const FEED_LIMIT = 40;
const SHIFT_DAYS = 14;

// Jobs being built come first in every picker; signed-and-coming next.
const JOB_RANK: Record<string, number> = { in_progress: 0, contracted: 1, on_hold: 2 };

const hoursBetween = (start: string, end: string | null) =>
  end ? Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000) : null;

/**
 * GET /api/sub-portal/logs
 * The sub's field view: their open clock (if any, with the geofence result),
 * the active jobs they can clock into / post on, their own shifts from the
 * last two weeks (for the hours strip), and the recent daily-log feed across
 * their jobs — crew posts and sub posts alike, photos signed. No pricing.
 */
export async function GET(request: NextRequest) {
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, subId } = access;

  const projectIds = await getSubProjectIds(supabase, subId);
  if (projectIds.length === 0) {
    return NextResponse.json({ clock: null, jobs: [], logs: [], shifts: [], trades: [] });
  }

  const shiftsSince = new Date(Date.now() - SHIFT_DAYS * 86_400_000).toISOString();

  const [projectsRes, clockRes, logsRes, shiftsRes, subRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, project_number, status, address, city, latitude, longitude")
      .in("id", projectIds),
    supabase
      .from("daily_logs")
      .select("id, project_id, started_at, clock_in_on_site, clock_in_distance_m")
      .eq("subcontractor_id", subId)
      .eq("status", "in_progress")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("daily_logs")
      .select(
        `id, project_id, author_id, subcontractor_id, kind, text, photo_storage_paths, status, started_at, ended_at,
         author:profiles!author_id(full_name, email),
         sub:subcontractors!subcontractor_id(company_name, contact_name),
         project:projects!project_id(name)`,
      )
      .in("project_id", projectIds)
      .order("started_at", { ascending: false })
      .limit(FEED_LIMIT * 2),
    supabase
      .from("daily_logs")
      .select("id, project_id, started_at, ended_at, status, clock_in_on_site")
      .eq("subcontractor_id", subId)
      .eq("kind", "shift")
      .gte("started_at", shiftsSince)
      .order("started_at", { ascending: false })
      .limit(80),
    supabase.from("subcontractors").select("trades").eq("id", subId).maybeSingle(),
  ]);

  const projects = projectsRes.data || [];
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "Job";

  // Jobs a sub can clock into / post on — the same live whitelist as the
  // Jobs tab (building, signed, on hold) plus closing-out jobs, since a
  // service call after the punch list is real. Proposal-stage jobs stay out
  // of the pickers so a 17-job list doesn't bury today's site.
  const ACTIONABLE = ["in_progress", "contracted", "on_hold", "audit"];
  const jobs = projects
    .filter((p) => ACTIONABLE.includes(p.status))
    .sort(
      (a, b) =>
        (JOB_RANK[a.status] ?? 9) - (JOB_RANK[b.status] ?? 9) || a.name.localeCompare(b.name),
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      project_number: p.project_number,
      address: [p.address, p.city].filter(Boolean).join(", "),
      // Job pin, so the phone can pick the job the sub is standing on.
      lat: p.latitude ?? null,
      lng: p.longitude ?? null,
    }));

  // Bare clock-outs (no note, no photos) are time records, not feed posts —
  // same rule as the in-app feed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((logsRes.data || []) as any[])
    .filter(
      (r) =>
        r.status === "in_progress" ||
        !!r.text?.trim() ||
        (r.photo_storage_paths?.length ?? 0) > 0,
    )
    .slice(0, FEED_LIMIT);

  const allPaths: string[] = rows.flatMap((r) => r.photo_storage_paths ?? []);
  const signedMap = new Map<string, string>();
  let thumbMap = new Map<string, string>();
  if (allPaths.length > 0) {
    const [{ data: signed }, thumbs] = await Promise.all([
      cachedSignedUrls(supabase, PHOTO_BUCKET, allPaths, SIGNED_TTL),
      signThumbUrls(supabase, PHOTO_BUCKET, allPaths, SIGNED_TTL),
    ]);
    (signed ?? []).forEach((s) => {
      if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
    });
    thumbMap = thumbs;
  }

  const logs = rows.map((r) => {
    const author = Array.isArray(r.author) ? r.author[0] : r.author;
    const sub = Array.isArray(r.sub) ? r.sub[0] : r.sub;
    const project = Array.isArray(r.project) ? r.project[0] : r.project;
    const paths: string[] = r.photo_storage_paths ?? [];
    return {
      id: r.id,
      project_id: r.project_id,
      project_name: project?.name ?? "Project",
      author_name:
        author?.full_name ??
        author?.email?.split("@")[0] ??
        (sub ? sub.contact_name || sub.company_name : null) ??
        "Field",
      is_mine: r.subcontractor_id === subId,
      kind: r.kind ?? null,
      hours: r.kind === "shift" && r.status === "completed" ? hoursBetween(r.started_at, r.ended_at) : null,
      text: r.text,
      status: r.status,
      started_at: r.started_at,
      ended_at: r.ended_at,
      photo_urls: paths.map((p) => signedMap.get(p)).filter((u): u is string => !!u),
      photo_thumb_urls: paths
        .map((p) => thumbMap.get(p) ?? signedMap.get(p))
        .filter((u): u is string => !!u),
    };
  });

  const shifts = (shiftsRes.data || []).map((s) => ({
    id: s.id,
    project_id: s.project_id,
    project_name: projectName(s.project_id),
    started_at: s.started_at,
    ended_at: s.status === "completed" ? s.ended_at : null,
    on_site: s.clock_in_on_site ?? null,
  }));

  const clock = clockRes.data
    ? {
        logId: clockRes.data.id,
        project_id: clockRes.data.project_id,
        project_name: projectName(clockRes.data.project_id),
        address: jobs.find((j) => j.id === clockRes.data!.project_id)?.address ?? "",
        started_at: clockRes.data.started_at,
        on_site: clockRes.data.clock_in_on_site ?? null,
        distance_m: clockRes.data.clock_in_distance_m ?? null,
      }
    : null;

  const trades = ((subRes.data?.trades as string[] | null) ?? []).map((t) => String(t).toLowerCase());

  return NextResponse.json({ clock, jobs, logs, shifts, trades });
}

/**
 * POST /api/sub-portal/logs  { projectId, text, pendingPhotoCount }
 * Post a field update onto one of the sub's jobs — lands as a completed
 * daily log (kind 'post') attributed to the subcontractor, so it shows in
 * the office feed like any crew update. Photos append afterwards via
 * /api/sub-portal/logs/photo.
 */
export async function POST(request: NextRequest) {
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, subId } = access;

  let body: { projectId?: string; text?: string; pendingPhotoCount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const projectId = (body.projectId || "").trim();
  const text = (body.text || "").trim().slice(0, 4000);
  const pendingPhotos = Number(body.pendingPhotoCount) || 0;
  if (!projectId) return NextResponse.json({ error: "Pick a job first" }, { status: 400 });
  if (!text && pendingPhotos === 0) {
    return NextResponse.json({ error: "Add a note or a photo before posting" }, { status: 400 });
  }

  const projectIds = await getSubProjectIds(supabase, subId);
  if (!projectIds.includes(projectId)) {
    return NextResponse.json({ error: "That job isn't on your list" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("daily_logs")
    .insert({
      project_id: projectId,
      subcontractor_id: subId,
      author_id: null,
      kind: "post",
      status: "completed",
      text: text || null,
      ended_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, logId: data.id });
}
