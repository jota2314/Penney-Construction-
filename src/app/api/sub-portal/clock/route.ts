import { NextRequest, NextResponse } from "next/server";
import { resolveSubAccess, getSubProjectIds } from "@/lib/sub-portal/access";
import { distanceMeters, GEOFENCE_METERS } from "@/lib/crew/geo";

export const runtime = "nodejs";

const MAX_TAGS = 12;
const MAX_TAG_LEN = 40;
const MAX_NOTE_LEN = 4000;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

/**
 * POST /api/sub-portal/clock
 *   { action: "in", projectId, loc? }
 *       → open an in_progress daily_log on the job; returns the geofence result
 *   { action: "out", tags?, note?, endedAt? }
 *       → close it. The log gets an "On site …" line, then a "Work:" line from
 *         the tags, then the sub's note — so the shift reads as a real daily
 *         log in the office feed. `endedAt` lets a sub who forgot to clock out
 *         set the true end time (bounded: after clock-in, not in the future).
 * One clock at a time, same rule as crew. Geofence stamps are best-effort and
 * never block a clock-in.
 */
export async function POST(request: NextRequest) {
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, subId } = access;

  let body: {
    action?: string;
    projectId?: string;
    note?: string;
    tags?: unknown;
    endedAt?: string;
    loc?: { lat: number; lng: number; accuracy?: number } | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const { data: open } = await supabase
    .from("daily_logs")
    .select("id, project_id, started_at")
    .eq("subcontractor_id", subId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (body.action === "in") {
    const projectId = (body.projectId || "").trim();
    if (!projectId) return NextResponse.json({ error: "Pick a job first" }, { status: 400 });

    if (open) {
      if (open.project_id === projectId) {
        return NextResponse.json({ ok: true, logId: open.id, started_at: open.started_at });
      }
      return NextResponse.json(
        { error: "You're already clocked in on another job. Clock out first." },
        { status: 409 },
      );
    }

    const projectIds = await getSubProjectIds(supabase, subId);
    if (!projectIds.includes(projectId)) {
      return NextResponse.json({ error: "That job isn't on your list" }, { status: 403 });
    }

    // Geofence stamp vs the job pin, mirroring the crew clock-in.
    const loc = body.loc ?? null;
    let onSite: boolean | null = null;
    let distanceM: number | null = null;
    if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
      const { data: project } = await supabase
        .from("projects")
        .select("latitude, longitude")
        .eq("id", projectId)
        .maybeSingle();
      if (project?.latitude != null && project?.longitude != null) {
        distanceM = Math.round(distanceMeters(loc.lat, loc.lng, project.latitude, project.longitude));
        onSite = distanceM <= GEOFENCE_METERS;
      }
    }

    const { data, error } = await supabase
      .from("daily_logs")
      .insert({
        project_id: projectId,
        subcontractor_id: subId,
        author_id: null,
        kind: "shift",
        status: "in_progress",
        clock_in_lat: loc?.lat ?? null,
        clock_in_lng: loc?.lng ?? null,
        clock_in_accuracy: loc?.accuracy ?? null,
        clock_in_distance_m: distanceM,
        clock_in_on_site: onSite,
      })
      .select("id, started_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      logId: data.id,
      started_at: data.started_at,
      on_site: onSite,
      distance_m: distanceM,
    });
  }

  if (body.action === "out") {
    if (!open) return NextResponse.json({ error: "You're not clocked in." }, { status: 400 });

    const now = new Date();
    const started = new Date(open.started_at);

    // Optional corrected end time — for the "forgot to clock out" case.
    let endedAt = now;
    if (body.endedAt) {
      const wanted = new Date(body.endedAt);
      if (Number.isNaN(wanted.getTime())) {
        return NextResponse.json({ error: "That end time doesn't look right." }, { status: 400 });
      }
      if (wanted.getTime() <= started.getTime()) {
        return NextResponse.json({ error: "End time has to be after you clocked in." }, { status: 400 });
      }
      // Two minutes of clock skew is fine; the future is not.
      if (wanted.getTime() > now.getTime() + 2 * 60_000) {
        return NextResponse.json({ error: "End time can't be in the future." }, { status: 400 });
      }
      endedAt = wanted;
    }

    const hours = Math.max(0, (endedAt.getTime() - started.getTime()) / 3_600_000);

    const tags = Array.isArray(body.tags)
      ? (body.tags as unknown[])
          .map((t) => String(t ?? "").trim().slice(0, MAX_TAG_LEN))
          .filter(Boolean)
          .slice(0, MAX_TAGS)
      : [];
    const note = (body.note || "").trim().slice(0, MAX_NOTE_LEN);

    // The auto line keeps the shift visible in the office feed (bare
    // clock-outs are filtered out of it); tags + note make it a real log.
    const shiftLine = `On site ${fmtTime(open.started_at)} – ${fmtTime(endedAt.toISOString())} (${hours.toFixed(1)} h)`;
    const text = [shiftLine, tags.length ? `Work: ${tags.join(", ")}` : "", note]
      .filter(Boolean)
      .join("\n");

    const { error } = await supabase
      .from("daily_logs")
      .update({
        status: "completed",
        ended_at: endedAt.toISOString(),
        text,
      })
      .eq("id", open.id)
      .eq("subcontractor_id", subId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, logId: open.id, hours: Number(hours.toFixed(2)) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
