import { after, NextRequest, NextResponse } from "next/server";
import { resolveSubAccess } from "@/lib/sub-portal/access";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";
import { isSubOnJob } from "@/lib/sub-portal/active-jobs";
import { revalidateSchedule } from "@/lib/schedule/revalidate";
import { isCalendarDate } from "@/lib/schedule/date-patch";
import { notifySubException } from "@/lib/notifications/sub-field-notify";
import type { SubInspectionActionResponse } from "@/lib/sub-portal/payload";
import { isMyTradeInspection } from "../logs/capture";

export const runtime = "nodejs";

const STATUSES = ["pending", "passed", "failed"] as const;
type Status = (typeof STATUSES)[number];

// A calendar day at noon UTC is the same day in Massachusetts.
const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

const json = (body: SubInspectionActionResponse, status = 200) => NextResponse.json(body, { status });

/**
 * POST /api/sub-portal/inspections  SubInspectionActionRequest
 *   { id, status?: "pending"|"passed"|"failed", scheduledFor?: "YYYY-MM-DD", note? }
 *
 * The validated portal member updates the checklist and its explicitly
 * linked master milestone atomically. Bookings use a structured date;
 * completion is an actual timestamp, never a replacement planned date.
 *
 * Only inspections of his own trade (isMyTradeInspection: "Plumbing rough"
 * is the plumber's; a final or building inspection is nobody's) on one of
 * his live jobs that the office put him on (isSubOnJob assignedOnly: a QR
 * sign-up or a visit alone isn't enough); the rest show to him read-only. Every change writes a feed
 * post attributed to his company, and a new failure pings the PM and Jorge.
 */
export async function POST(request: NextRequest) {
  const refused = await refuseStaffBrowser(request);
  if (refused) return refused;
  const access = await resolveSubAccess(request);
  if (!access) return json({ error: "Not signed in" }, 401);
  const { supabase, subId, contactName, companyName, trades } = access;

  let body: { id?: string; status?: string; scheduledFor?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const id = (body.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Missing inspection" }, 400);

  const status = body.status ? (body.status as Status) : null;
  if (status && !STATUSES.includes(status)) {
    return json({ error: "Status must be pending, passed, or failed" }, 400);
  }
  const scheduledFor = (body.scheduledFor || "").trim();
  if (scheduledFor && !isCalendarDate(scheduledFor)) {
    return json({ error: "Date must be YYYY-MM-DD" }, 400);
  }
  const note = (body.note || "").trim().slice(0, 1000);
  if (!status && !scheduledFor && !note) {
    return json({ error: "Nothing to update" }, 400);
  }

  const { data: insp } = await supabase
    .from("project_inspections")
    .select("id, project_id, name, status, notes, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!insp) return json({ error: "Inspection not found" }, 404);

  if (!(await isSubOnJob(supabase, subId, insp.project_id))) {
    return json({ error: "That job isn't on your list" }, 403);
  }
  if (!isMyTradeInspection(insp.name, trades)) {
    return json({ error: "That inspection isn't your trade. Call the office if it should be." }, 403);
  }
  // A QR visit or his own posts put him on the job for photos, not for
  // marking its inspections: that takes something the office set up
  // (an assigned phase, an award, an active link, a work order).
  if (!(await isSubOnJob(supabase, subId, insp.project_id, { assignedOnly: true }))) {
    return json({ error: "Penney hasn't put you on this job yet. Call the office to update this inspection." }, 403);
  }

  // Office notes on the row stay; the sub's line goes on top. A fresh
  // booking replaces any earlier "Scheduled for …" line instead of stacking.
  const existing = String(insp.notes || "")
    .split("\n")
    .filter((l: string) => !/^Scheduled for /.test(l.trim()))
    .join("\n")
    .trim();
  const withExisting = (top: string) => (existing ? `${top}\n${existing}` : top);

  // What we write, and the one-liner the office reads.
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  let line = "";
  if (status === "passed" || status === "failed") {
    patch.status = status;
    line = `${insp.name}: ${status.toUpperCase()}`;
    if (note) patch.notes = withExisting(note);
  } else if (scheduledFor) {
    patch.status = "pending";
    patch.scheduled_for = scheduledFor;
    patch.notes = withExisting(note ? `Scheduled for ${fmtDay(scheduledFor)} — ${note}` : `Scheduled for ${fmtDay(scheduledFor)}`);
    line = `${insp.name}: scheduled for ${fmtDay(scheduledFor)}`;
  } else if (status === "pending") {
    patch.status = "pending";
    patch.completed_at = null;
    if (note) patch.notes = withExisting(note);
    line = `${insp.name}: back to pending`;
  } else {
    patch.notes = withExisting(note);
    line = `${insp.name}: ${note}`;
  }
  if (note && line && !line.includes(note)) line += ` — ${note}`;

  const { error } = await supabase.rpc("update_project_inspection_lifecycle", {
    p_inspection_id: id,
    p_patch: patch,
    p_expected_updated_at: insp.updated_at,
    p_source: "sub-portal",
    p_subcontractor_id: subId,
  });
  if (error) {
    // Someone in the office changed it since his screen loaded.
    const stale = /changed\. refresh/i.test(error.message);
    return json({ error: stale ? "Someone just updated this. Pull down to refresh and try again." : error.message }, stale ? 409 : 500);
  }
  revalidateSchedule(insp.project_id);

  // Feed line, attributed to the sub. Best-effort: the inspection is
  // already updated even if this insert fails.
  const { data: post } = await supabase
    .from("daily_logs")
    .insert({
      project_id: insp.project_id,
      subcontractor_id: subId,
      author_id: null,
      kind: "post",
      status: "completed",
      text: `Inspection — ${line}`,
      started_at: nowIso,
      ended_at: nowIso,
    })
    .select("id")
    .maybeSingle();

  // A failed inspection reaches the office right away, once per failure
  // (a second "Failed" tap on an already failed row doesn't ping again).
  if (status === "failed" && insp.status !== "failed") {
    const projectId = insp.project_id as string;
    const logId = (post?.id as string | undefined) ?? id;
    after(() =>
      notifySubException({
        subId,
        projectId,
        logId,
        kind: "inspection_failed",
        inspectionName: insp.name,
        text: note || null,
      }),
    );
  }

  return json({ ok: true, by: contactName || companyName, line });
}
