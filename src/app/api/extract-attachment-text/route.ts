import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  extractAttachmentText,
  type AttachmentMeta,
} from "@/lib/actions/extract-attachment";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { emailId } = await request.json();
    if (!emailId)
      return NextResponse.json(
        { error: "emailId required" },
        { status: 400 }
      );

    const { data: email } = await supabase
      .from("inbox_emails")
      .select("id, attachments")
      .eq("id", emailId)
      .single();

    if (!email)
      return NextResponse.json({ error: "Email not found" }, { status: 404 });

    const attachments = (email.attachments || []) as AttachmentMeta[];

    const { attachments: processed, updated } =
      await extractAttachmentText(supabase, attachments);

    if (updated) {
      await supabase
        .from("inbox_emails")
        .update({ attachments: processed })
        .eq("id", emailId);
    }

    return NextResponse.json({ attachments: processed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
