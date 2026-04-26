import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGoogleTokens } from "@/lib/google/auth";
import { syncGmailForUser } from "@/lib/email/gmail-sync";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { limit = 20 } = await request.json().catch(() => ({}));

    const tokens = await getGoogleTokens();
    if (!tokens) {
      return NextResponse.json(
        { error: "No Google OAuth tokens. Sign out and sign back in to grant Gmail access." },
        { status: 401 }
      );
    }

    const result = await syncGmailForUser({
      supabase,
      accessToken: tokens.access_token,
      userId: user.id,
      limit,
    });

    const skipped = result.scanned - result.stored;
    return NextResponse.json({
      stored: result.stored,
      skipped,
      errors: result.errors.length > 0 ? result.errors : undefined,
      message:
        result.stored === 0
          ? `Scanned ${result.scanned} emails — all already stored`
          : `Stored ${result.stored} new emails (scanned ${result.scanned}, skipped ${skipped} duplicates)${result.errors.length > 0 ? `, ${result.errors.length} errors` : ""}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { emailId, is_dismissed } = await request.json();
  if (!emailId) return NextResponse.json({ error: "emailId required" }, { status: 400 });

  const { error } = await supabase
    .from("inbox_emails")
    .update({ is_dismissed: !!is_dismissed })
    .eq("id", emailId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
