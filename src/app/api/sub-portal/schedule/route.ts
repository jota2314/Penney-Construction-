import { NextRequest, NextResponse, after } from "next/server";
import { resolveSubAccess, getSubProjectIds } from "@/lib/sub-portal/access";
import { notifySubScheduleEvent } from "@/lib/notifications/tagged-mentions";

// The office fan-out (in-app + push + Gmail) takes seconds; the sub's tap
// shouldn't wait on it. `after` keeps the function alive past the response.
const notifyLater = (args: Parameters<typeof notifySubScheduleEvent>[0]) =>
  after(() => notifySubScheduleEvent(args).catch((err) => console.error("[sub-schedule] notify failed", err)));
import { formatShortRange } from "@/lib/notifications/schedule-notify";

export const runtime = "nodejs";

// Whose account carries a sub-created phase's created_by (NOT NULL, and subs
// have no profile): the job's PM, else precon.
const FALLBACK_CREATOR_EMAIL = "jbetancur@penneyconstructioninc.com";
const SUB_PHASE_COLOR = "#d97706";

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const uuidish = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * POST /api/sub-portal/schedule — the sub's side of two-way scheduling.
 *
 *   { action: "confirm", phaseId, note? }   he'll be there
 *   { action: "decline", phaseId, note? }   he can't make it
 *   { action: "propose", projectId, startDate, endDate, name, crew?, note? }
 *                                            his own dates go on the calendar
 *   { action: "cancel", phaseId }            takes his own dates back off
 *
 * Confirm/decline only record the sub's answer — is_confirmed stays the
 * office's flag. A proposed phase is inserted already confirmed and assigned
 * to him, so it shows on the office schedule and the crew board at once.
 * Every action notifies Jorge, Ryan, and the job's PM.
 */
export async function POST(request: NextRequest) {
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, subId, contactName, companyName } = access;
  const subName = contactName || companyName;

  let body: {
    action?: string;
    phaseId?: string;
    note?: string;
    projectId?: string;
    startDate?: string;
    endDate?: string;
    name?: string;
    crew?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const note = (body.note || "").trim().slice(0, 1000);
  const nowIso = new Date().toISOString();

  // ── Answer a phase the office put him on ────────────────────────────────
  if (body.action === "confirm" || body.action === "decline") {
    const phaseId = (body.phaseId || "").trim();
    if (!uuidish(phaseId)) return NextResponse.json({ error: "Missing phase" }, { status: 400 });

    const { data: phase } = await supabase
      .from("schedule_phases")
      .select("id, project_id, name, start_date, end_date, assigned_sub_ids, is_confirmed")
      .eq("id", phaseId)
      .maybeSingle();
    if (!phase || !(phase.assigned_sub_ids ?? []).includes(subId)) {
      return NextResponse.json({ error: "That's not on your schedule" }, { status: 404 });
    }

    const response = body.action === "confirm" ? "confirmed" : "declined";
    const { error } = await supabase
      .from("schedule_phases")
      .update({
        sub_response: response,
        sub_responded_at: nowIso,
        sub_response_note: note || null,
        updated_at: nowIso,
      })
      .eq("id", phaseId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: project } = phase.project_id
      ? await supabase.from("projects").select("name").eq("id", phase.project_id).maybeSingle()
      : { data: null };
    const range = formatShortRange(phase.start_date, phase.end_date);
    const title =
      response === "confirmed"
        ? `${subName} confirmed ${range} — ${project?.name ?? "job"}`
        : `${subName} can't make ${range} — ${project?.name ?? "job"}`;
    const lines = [`${phase.name} · ${range}`, project?.name ?? "", note ? `Note from ${subName}: ${note}` : ""].filter(Boolean);
    notifyLater({
      subName,
      projectId: phase.project_id,
      title,
      body: lines.join("\n"),
      url: phase.project_id ? `/projects/${phase.project_id}` : "/schedule",
    });

    return NextResponse.json({ ok: true, response });
  }

  // ── He puts his own dates on the calendar ───────────────────────────────
  if (body.action === "propose") {
    const projectId = (body.projectId || "").trim();
    const startDate = (body.startDate || "").trim();
    const endDate = (body.endDate || startDate).trim();
    const name = (body.name || "").trim().slice(0, 120);
    const crew = Number.isFinite(Number(body.crew)) && Number(body.crew) > 0 ? Math.min(50, Math.round(Number(body.crew))) : null;

    if (!uuidish(projectId)) return NextResponse.json({ error: "Pick a job" }, { status: 400 });
    if (!isDate(startDate) || !isDate(endDate)) return NextResponse.json({ error: "Pick the dates" }, { status: 400 });
    if (endDate < startDate) return NextResponse.json({ error: "End date has to be on or after the start" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Say what you'll be doing" }, { status: 400 });

    const projectIds = await getSubProjectIds(supabase, subId);
    if (!projectIds.includes(projectId)) {
      return NextResponse.json({ error: "That job isn't on your list" }, { status: 403 });
    }

    const [{ data: project }, { data: fallback }] = await Promise.all([
      supabase.from("projects").select("name, assigned_pm").eq("id", projectId).maybeSingle(),
      supabase.from("profiles").select("id").eq("email", FALLBACK_CREATOR_EMAIL).maybeSingle(),
    ]);
    const creator = project?.assigned_pm ?? fallback?.id ?? null;
    if (!creator) return NextResponse.json({ error: "Couldn't file this. Call the office." }, { status: 500 });

    const notes = [crew ? `Crew: ${crew}` : "", note].filter(Boolean).join("\n") || null;
    const confirmedWith = `${subName} (portal)`;

    const { data: created, error } = await supabase
      .from("schedule_phases")
      .insert({
        project_id: projectId,
        name,
        description: null,
        start_date: startDate,
        end_date: endDate,
        planned_start_date: startDate,
        planned_end_date: endDate,
        status: "not_started",
        sort_order: 0,
        assigned_employee_ids: [],
        assigned_sub_ids: [subId],
        color: SUB_PHASE_COLOR,
        notes,
        created_by: creator,
        created_by_sub_id: subId,
        event_type: "work",
        phase_scope: "daily",
        is_confirmed: true,
        confirmed_at: nowIso,
        confirmed_with: confirmedWith,
        sub_response: "confirmed",
        sub_responded_at: nowIso,
        sub_response_note: note || null,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const range = formatShortRange(startDate, endDate);
    notifyLater({
      subName,
      projectId,
      title: `${subName} scheduled ${range} — ${project?.name ?? "job"}`,
      body: [`${name} · ${range}`, project?.name ?? "", crew ? `Crew of ${crew}` : "", note ? `Note: ${note}` : ""]
        .filter(Boolean)
        .join("\n"),
      url: `/projects/${projectId}`,
    });

    return NextResponse.json({ ok: true, phaseId: created.id });
  }

  // ── He takes his own dates back off ─────────────────────────────────────
  if (body.action === "cancel") {
    const phaseId = (body.phaseId || "").trim();
    if (!uuidish(phaseId)) return NextResponse.json({ error: "Missing phase" }, { status: 400 });

    const { data: phase } = await supabase
      .from("schedule_phases")
      .select("id, project_id, name, start_date, end_date, created_by_sub_id")
      .eq("id", phaseId)
      .maybeSingle();
    if (!phase || phase.created_by_sub_id !== subId) {
      return NextResponse.json({ error: "You can only take off dates you added" }, { status: 403 });
    }

    const { error } = await supabase.from("schedule_phases").delete().eq("id", phaseId).eq("created_by_sub_id", subId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: project } = phase.project_id
      ? await supabase.from("projects").select("name").eq("id", phase.project_id).maybeSingle()
      : { data: null };
    const range = formatShortRange(phase.start_date, phase.end_date);
    notifyLater({
      subName,
      projectId: phase.project_id,
      title: `${subName} took ${range} off the calendar — ${project?.name ?? "job"}`,
      body: [`${phase.name} · ${range}`, project?.name ?? ""].filter(Boolean).join("\n"),
      url: phase.project_id ? `/projects/${phase.project_id}` : "/schedule",
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
