import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const trade = url.searchParams.get("trade");
  const tradeLabel = url.searchParams.get("tradeLabel");
  const listAll = url.searchParams.get("listAll");

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // ── List all trade conversations for the trade picker ──────
  if (listAll === "true") {
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("project_id", projectId)
      .like("title", "Takeoff - %")
      .order("updated_at", { ascending: false });

    // Get message counts for each conversation
    const conversations = await Promise.all(
      (convs || []).map(async (c) => {
        const { count } = await supabase
          .from("conversation_messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", c.id);
        return { ...c, messageCount: count || 0 };
      })
    );

    return NextResponse.json({ conversations });
  }

  // ── Load a specific trade conversation ─────────────────────
  const chatTitle = trade
    ? `Takeoff - ${tradeLabel || trade}`
    : "Takeoff Estimating";

  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("project_id", projectId)
    .eq("title", chatTitle)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conv) {
    return NextResponse.json({ conversationId: null, messages: [] });
  }

  const { data: messages } = await supabase
    .from("conversation_messages")
    .select("role, content")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: true })
    .limit(100);

  return NextResponse.json({
    conversationId: conv.id,
    messages: messages || [],
  });
}
