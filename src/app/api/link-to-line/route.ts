import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Link an existing bid OR quote to an estimate line item.
// Pass {type: 'bid'|'quote', id, line_item_id}.
// When linking a bid that already has an amount and is_selected, mirror onto the line item.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { type, id, line_item_id } = await request.json();
  if (!type || !id || !line_item_id) {
    return NextResponse.json({ error: "type, id, line_item_id required" }, { status: 400 });
  }

  // Verify the line item exists + grab its project for revalidation
  const { data: line } = await supabase
    .from("estimate_line_items")
    .select("id, estimate:estimates(project_id)")
    .eq("id", line_item_id)
    .single();
  if (!line) return NextResponse.json({ error: "Line item not found" }, { status: 404 });
  const estimate = Array.isArray(line.estimate) ? line.estimate[0] : line.estimate;
  const projectId = estimate?.project_id;

  if (type === "bid") {
    const { data: bid, error } = await supabase
      .from("subcontractor_bids")
      .update({ estimate_line_item_id: line_item_id })
      .eq("id", id)
      .select("id, amount, status, is_selected, subcontractor_id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // If this bid was already awarded, mirror onto the line item now that it's linked
    if (bid.is_selected && bid.status === "accepted" && bid.amount) {
      await supabase
        .from("estimate_line_items")
        .update({
          awarded_bid_id: bid.id,
          awarded_subcontractor_id: bid.subcontractor_id,
          awarded_cost: bid.amount,
          awarded_at: new Date().toISOString(),
        })
        .eq("id", line_item_id);
    }
  } else if (type === "quote") {
    const { error } = await supabase
      .from("quote_requests")
      .update({ estimate_line_item_id: line_item_id })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    return NextResponse.json({ error: "type must be 'bid' or 'quote'" }, { status: 400 });
  }

  if (projectId) {
    revalidatePath(`/projects/${projectId}/bids`);
    revalidatePath(`/projects/${projectId}`);
  }
  return NextResponse.json({ success: true });
}
