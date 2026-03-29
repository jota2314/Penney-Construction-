import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface AttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
  storage_path: string | null;
  text_content?: string;
}

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
    let updated = false;

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      if (
        att.text_content !== undefined ||
        !att.storage_path ||
        !att.mimeType?.includes("pdf")
      ) {
        continue;
      }

      try {
        const { data: fileData, error: dlError } = await supabase.storage
          .from("email-attachments")
          .download(att.storage_path);

        if (dlError || !fileData) continue;

        const { PDFParse } = await import("pdf-parse");
        const arrayBuffer = await fileData.arrayBuffer();
        const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) });
        const parsed = await parser.getText();
        attachments[i] = {
          ...att,
          text_content: (parsed.text || "").substring(0, 50000),
        };
        updated = true;
      } catch {
        attachments[i] = { ...att, text_content: "" };
        updated = true;
      }
    }

    if (updated) {
      await supabase
        .from("inbox_emails")
        .update({ attachments })
        .eq("id", emailId);
    }

    return NextResponse.json({ attachments });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
