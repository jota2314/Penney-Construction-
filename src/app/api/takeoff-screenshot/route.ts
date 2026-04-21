/**
 * DELETE /api/takeoff-screenshot
 *
 * Removes a screenshot from the takeoff-screenshots/ prefix in the
 * email-attachments bucket. Guards: auth required, and the path must
 * start with 'takeoff-screenshots/' so callers can't nuke other buckets'
 * files through this endpoint.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const path = (body.path || "").trim();
  if (!path || !path.startsWith("takeoff-screenshots/")) {
    return NextResponse.json({ error: "path must start with takeoff-screenshots/" }, { status: 400 });
  }

  const { error } = await supabase.storage.from("email-attachments").remove([path]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, deleted: path });
}
