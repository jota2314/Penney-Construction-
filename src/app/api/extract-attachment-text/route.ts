import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_FALLBACK_MODELS } from "@/lib/ai/claude";

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
      // Skip if already extracted, no storage path, or not a readable type
      const isReadable = att.mimeType?.includes("pdf") || att.mimeType?.startsWith("image/");
      if (att.text_content !== undefined || !att.storage_path || !isReadable) {
        continue;
      }

      try {
        const { data: fileData, error: dlError } = await supabase.storage
          .from("email-attachments")
          .download(att.storage_path);

        if (dlError || !fileData) continue;

        const arrayBuffer = await fileData.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");

        // Use Claude's native document/image understanding
        const anthropic = await getAnthropicClient();
        let extractedText = "";

        const isPdf = att.mimeType?.includes("pdf");
        const contentBlock = isPdf
          ? {
              type: "document" as const,
              source: {
                type: "base64" as const,
                media_type: "application/pdf" as const,
                data: base64,
              },
            }
          : {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: att.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: base64,
              },
            };

        for (const model of CLAUDE_FALLBACK_MODELS) {
          try {
            const response = await anthropic.messages.create({
              model,
              max_tokens: 4096,
              messages: [
                {
                  role: "user",
                  content: [
                    contentBlock,
                    {
                      type: "text",
                      text: "Extract ALL text content from this document. Include every number, name, address, date, line item, total, and detail. Format it clearly. If it's an invoice or estimate, list all line items with amounts.",
                    },
                  ],
                },
              ],
            });
            extractedText =
              response.content[0]?.type === "text"
                ? response.content[0].text
                : "";
            if (extractedText) break;
          } catch {
            continue;
          }
        }

        attachments[i] = {
          ...att,
          text_content: extractedText.substring(0, 50000),
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
