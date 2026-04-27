import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { ids, action } = await request.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids[] required" }, { status: 400 });
  }
  if (!["done", "dismiss", "undo"].includes(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  // Scope every update to created_by = current user so users can never
  // mutate someone else's inbox.
  let update: Record<string, boolean>;
  if (action === "done") update = { is_processed: true, is_dismissed: false };
  else if (action === "dismiss") update = { is_dismissed: true, is_processed: false };
  else update = { is_processed: false, is_dismissed: false };

  const { error } = await supabase
    .from("inbox_emails")
    .update(update)
    .in("id", ids)
    .eq("created_by", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ updated: ids.length });
}
