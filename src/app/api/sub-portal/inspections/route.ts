import { NextRequest, NextResponse } from "next/server";
import { resolveSubAccess, getSubProjectIds } from "@/lib/sub-portal/access";

export const runtime = "nodejs";

const STATUSES = ["pending", "passed", "failed"] as const;
type Status = (typeof STATUSES)[number];

const fmtDay = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

/**
 * POST /api/sub-portal/inspections
 *   { id, status?: "pending"|"passed"|"failed", scheduledFor?: "YYYY-MM-DD", note? }
 *
 * The sub updates an inspection on one of his jobs — passed, failed, or
 * booked for a day. `project_inspections` has no schedule column, so a
 * booking is written into `notes` ("Scheduled for Fri, Sep 5") with the
 * status left pending. Every change also drops a one-line post into the
 * job's daily log so the office sees it in the feed without opening the
 * inspections table.
 */
export async function POST(request: NextRequest) {
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, subId, contactName, companyName } = access;

  let body: { id?: string; status?: string; scheduledFor?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const id = (body.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Missing inspection" }, { status: 400 });

  const status = body.status ? (body.status as Status) : null;
  if (status && !STATUSES.includes(status)) {
    return NextResponse.json({ error: "Status must be pending, passed, or failed" }, { status: 400 });
  }
  const scheduledFor = (body.scheduledFor || "").trim();
  if (scheduledFor && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)) {
    return NextResponse.json({ error: "Date must be YYYY-MM-DD" }, { status: 400 });
  }
  const note = (body.note || "").trim().slice(0, 1000);
  if (!status && !scheduledFor && !note) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: insp } = await supabase
    .from("project_inspections")
    .select("id, project_id, name, status, notes")
    .eq("id", id)
    .maybeSingle();
  if (!insp) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

  const projectIds = await getSubProjectIds(supabase, subId);
  if (!projectIds.includes(insp.project_id)) {
    return NextResponse.json({ error: "That job isn't on your list" }, { status: 403 });
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
  const patch: Record<string, unknown> = { updated_at: nowIso };
  let line = "";
  if (status === "passed" || status === "failed") {
    patch.status = status;
    patch.completed_at = nowIso;
    line = `${insp.name}: ${status.toUpperCase()}`;
    if (note) patch.notes = withExisting(note);
  } else if (scheduledFor) {
    patch.status = "pending";
    patch.completed_at = null;
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

  const { error } = await supabase.from("project_inspections").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Feed line, attributed to the sub. Best-effort: the inspection is
  // already updated even if this insert fails.
  await supabase.from("daily_logs").insert({
    project_id: insp.project_id,
    subcontractor_id: subId,
    author_id: null,
    kind: "post",
    status: "completed",
    text: `Inspection — ${line}`,
    ended_at: nowIso,
  });

  return NextResponse.json({ ok: true, by: contactName || companyName, line });
}
