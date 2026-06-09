import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface SelectionOption {
  id: string;
  label: string;
  description?: string;
  image_url?: string;
  price_delta?: number;
}

/**
 * POST /api/portal/select
 * Body: { token, selectionId, optionId }
 * The client picks one option for a pending selection. Flips it to 'selected'
 * and drops a todo on Jorge's list (self-reminder pattern — no auto-email).
 */
export async function POST(request: NextRequest) {
  const { token, selectionId, optionId } = await request.json();
  if (!token || !selectionId || !optionId) {
    return NextResponse.json({ error: "Missing token, selectionId, or optionId" }, { status: 400 });
  }

  const supabase = getPublicClient();

  // 1. Validate the portal + get its project scope.
  const { data: portal } = await supabase
    .from("client_portal_access")
    .select("id, project_id, client_name, enabled, created_by")
    .eq("token", token)
    .single();

  if (!portal) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  if (!portal.enabled) return NextResponse.json({ error: "Portal access is turned off" }, { status: 403 });

  // 2. Load the selection — scoped to THIS portal's project (prevents tampering).
  const { data: selection } = await supabase
    .from("client_selections")
    .select("id, project_id, category, options")
    .eq("id", selectionId)
    .eq("project_id", portal.project_id)
    .single();

  if (!selection) return NextResponse.json({ error: "Selection not found" }, { status: 404 });

  // 3. Resolve the chosen option from the loaded options.
  const options = (selection.options as SelectionOption[]) || [];
  const chosen = options.find((o) => o.id === optionId);
  if (!chosen) return NextResponse.json({ error: "That option is no longer available" }, { status: 400 });

  // 4. Record the pick.
  const { error: updErr } = await supabase
    .from("client_selections")
    .update({
      status: "selected",
      selected_option_id: chosen.id,
      selected_value: chosen.label,
      selected_at: new Date().toISOString(),
      selected_by: portal.client_name || "Client",
      updated_at: new Date().toISOString(),
    })
    .eq("id", selection.id);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // 5. Best-effort: drop a todo on Jorge's list so he sees the pick.
  //    Never blocks the client — the selection is already recorded.
  if (portal.created_by) {
    try {
      const { data: proj } = await supabase
        .from("projects")
        .select("name")
        .eq("id", portal.project_id)
        .single();
      await supabase.from("todos").insert({
        project_id: portal.project_id,
        project_name: proj?.name || null,
        contact_name: portal.client_name || "Client",
        contact_type: "client",
        description: `Client selected "${chosen.label}" for ${selection.category}`,
        category: "general",
        priority: "medium",
        source: "client_portal",
        created_by: portal.created_by,
      });
    } catch {
      /* notification is non-critical */
    }
  }

  return NextResponse.json({ success: true, selected: chosen.label });
}
