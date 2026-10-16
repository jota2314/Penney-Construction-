import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type Kind = "phase" | "item" | "decision";
type Action =
  | "complete" | "uncomplete"      // schedule phase
  | "approve" | "remove" | "clear"  // selection-sheet item
  | "done" | "not_needed" | "restore"; // decision row

const ALLOWED: Record<Kind, Action[]> = {
  phase: ["complete", "uncomplete"],
  item: ["approve", "remove", "clear"],
  decision: ["done", "not_needed", "restore"],
};

/**
 * POST /api/portal/action
 * Body: { token, kind, id, action }
 *
 * The client's own taps on their portal: mark a schedule phase complete,
 * approve or remove a product on the published selection sheet, mark a
 * decision done or not needed — and undo any of those.
 *
 * Nothing here erases data. Remove / Not needed only hide the row from the
 * client (the team restores it from the Portal tab), a phase marked complete
 * shows as done on the portal only (the board status stays the team's), and
 * every tap drops a to-do on the team's list (self-reminder pattern, no
 * auto-email — client comms stay in email).
 */
export async function POST(request: NextRequest) {
  const { token, kind, id, action } = (await request.json()) as { token?: string; kind?: Kind; id?: string; action?: Action };
  if (!token || !kind || !id || !action || !ALLOWED[kind]?.includes(action)) {
    return NextResponse.json({ error: "Missing or invalid request" }, { status: 400 });
  }

  const supabase = getPublicClient();
  const { data: portal } = await supabase
    .from("client_portal_access")
    .select("id, project_id, client_name, enabled, created_by")
    .eq("token", token)
    .single();
  if (!portal) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  if (!portal.enabled) return NextResponse.json({ error: "Portal access is turned off" }, { status: 403 });

  const who = portal.client_name || "Client";
  const now = new Date().toISOString();
  let note: string;

  if (kind === "phase") {
    // Master schedule rows of THIS project only — daily crew rows are internal.
    const { data: phase } = await supabase
      .from("schedule_phases")
      .select("id, name")
      .eq("id", id)
      .eq("project_id", portal.project_id)
      .eq("phase_scope", "master")
      .single();
    if (!phase) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const done = action === "complete";
    const { error } = await supabase
      .from("schedule_phases")
      .update({ client_completed_at: done ? now : null, client_completed_by: done ? who : null })
      .eq("id", phase.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    note = done
      ? `Client marked "${phase.name}" complete on the portal. Confirm on the board.`
      : `Client undid "complete" on "${phase.name}".`;
  } else if (kind === "item") {
    // Items on a PUBLISHED sheet of this project only.
    const { data: item } = await supabase
      .from("client_selection_items")
      .select("id, name, client_selection_sheets!inner(project_id, published_at, title, revision)")
      .eq("id", id)
      .eq("client_selection_sheets.project_id", portal.project_id)
      .not("client_selection_sheets.published_at", "is", null)
      .single();
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const value = action === "clear" ? null : action === "approve" ? "approved" : "removed";
    const { error } = await supabase
      .from("client_selection_items")
      .update({ client_action: value, client_action_at: value ? now : null, client_action_by: value ? who : null, updated_at: now })
      .eq("id", item.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    note = action === "approve"
      ? `Client approved "${item.name}" on the selection sheet.`
      : action === "remove"
        ? `Client removed "${item.name}" from the selection sheet. Restore it from the Portal tab if needed.`
        : `Client undid their choice on "${item.name}".`;
  } else {
    const { data: row } = await supabase
      .from("client_selections")
      .select("id, category, status, selected_value, client_done_at")
      .eq("id", id)
      .eq("project_id", portal.project_id)
      .eq("client_visible", true)
      .single();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    let patch: Record<string, unknown>;
    if (action === "done") {
      patch = {
        status: "selected",
        selected_value: row.selected_value || "Done",
        selected_at: now,
        selected_by: who,
        client_done_at: now,
        client_dismissed_at: null,
      };
      note = `Client marked "${row.category}" done on the portal.`;
    } else if (action === "not_needed") {
      patch = { client_dismissed_at: now };
      note = `Client marked "${row.category}" not needed. Restore it from the Portal tab if it is.`;
    } else {
      // restore: undo the client's own Done and/or Not needed.
      patch = { client_dismissed_at: null };
      if (row.client_done_at) {
        patch.client_done_at = null;
        patch.status = "pending";
        if (row.selected_value === "Done") patch.selected_value = null;
      }
      note = `Client undid their change on "${row.category}".`;
    }
    const { error } = await supabase
      .from("client_selections")
      .update({ ...patch, updated_at: now })
      .eq("id", row.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await notifyTeam(supabase, portal, note);
  return NextResponse.json({ success: true });
}

// Best-effort to-do on the list of whoever created the portal. Never blocks
// the client — the change is already saved.
async function notifyTeam(
  supabase: SupabaseClient,
  portal: { project_id: string; client_name: string | null; created_by: string | null },
  description: string,
) {
  if (!portal.created_by) return;
  try {
    const { data: proj } = await supabase.from("projects").select("name").eq("id", portal.project_id).single();
    await supabase.from("todos").insert({
      project_id: portal.project_id,
      project_name: proj?.name || null,
      contact_name: portal.client_name || "Client",
      contact_type: "client",
      description,
      category: "follow_up_clients",
      priority: "medium",
      source: "client_portal",
      created_by: portal.created_by,
    });
  } catch {
    /* notification is non-critical */
  }
}
