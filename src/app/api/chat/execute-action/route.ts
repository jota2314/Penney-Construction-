/**
 * Execute an approved action from the AI chat.
 * Called when the user taps "Approve" or "Send" on an action card.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeTool } from "@/lib/ai/tool-handlers";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { action_type, data } = await request.json();

    if (!action_type || !data) {
      return NextResponse.json(
        { error: "action_type and data are required" },
        { status: 400 }
      );
    }

    // Execute the tool
    const resultStr = await executeTool(action_type, data, supabase, user.id);
    const result = JSON.parse(resultStr);

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, result });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
