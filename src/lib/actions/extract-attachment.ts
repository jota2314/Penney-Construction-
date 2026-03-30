import { SupabaseClient } from "@supabase/supabase-js";
import { getAnthropicClient, CLAUDE_HAIKU } from "@/lib/ai/claude";
import * as XLSX from "xlsx";

export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
  storage_path: string | null;
  text_content?: string;
}

const EXTRACTION_PROMPT =
  "Extract ALL text from this document. Include every number, name, address, date, line item, total, and detail. Format it clearly. If it's an invoice or estimate, list all line items with amounts.";

/**
 * Extract text from PDF/image attachments using Claude's document understanding.
 *
 * Downloads each qualifying attachment from Supabase storage, converts to base64,
 * sends to Claude for text extraction, and returns the updated attachments array.
 *
 * @param supabase  - An authenticated Supabase client
 * @param attachments - The attachments array (mutated in place and returned)
 * @returns `{ attachments, updated }` where `updated` is true if any extraction occurred
 */
export async function extractAttachmentText(
  supabase: SupabaseClient,
  attachments: AttachmentMeta[]
): Promise<{ attachments: AttachmentMeta[]; updated: boolean }> {
  const isReadableMime = (mime: string | undefined, filename: string | undefined) =>
    mime?.includes("pdf") ||
    mime?.startsWith("image/") ||
    mime?.includes("spreadsheet") ||
    mime?.includes("excel") ||
    mime === "text/csv" ||
    filename?.toLowerCase().endsWith(".xlsx") ||
    filename?.toLowerCase().endsWith(".xls") ||
    filename?.toLowerCase().endsWith(".csv");

  const needsExtraction = attachments.some(
    (a) =>
      a.storage_path &&
      isReadableMime(a.mimeType, a.filename) &&
      a.text_content === undefined
  );

  if (!needsExtraction) {
    return { attachments, updated: false };
  }

  const anthropic = await getAnthropicClient();
  let updated = false;

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    if (att.text_content !== undefined || !att.storage_path || !isReadableMime(att.mimeType, att.filename)) {
      continue;
    }

    try {
      const { data: fileData, error: dlError } = await supabase.storage
        .from("email-attachments")
        .download(att.storage_path);

      if (dlError || !fileData) continue;

      const arrayBuffer = await fileData.arrayBuffer();
      const isExcel =
        att.mimeType?.includes("spreadsheet") ||
        att.mimeType?.includes("excel") ||
        att.filename?.toLowerCase().endsWith(".xlsx") ||
        att.filename?.toLowerCase().endsWith(".xls");
      const isCsv = att.mimeType === "text/csv" || att.filename?.toLowerCase().endsWith(".csv");

      let extractedText = "";

      if (isExcel || isCsv) {
        // Parse spreadsheet locally — no AI needed
        try {
          const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
          const sheets: string[] = [];
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            if (csv.trim()) {
              sheets.push(
                workbook.SheetNames.length > 1
                  ? `## Sheet: ${sheetName}\n${csv}`
                  : csv
              );
            }
          }
          extractedText = sheets.join("\n\n");
        } catch {
          extractedText = "";
        }
      } else {
        // PDF or image — use Claude for extraction
        const base64 = Buffer.from(arrayBuffer).toString("base64");
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
                media_type: att.mimeType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/gif"
                  | "image/webp",
                data: base64,
              },
            };

        for (const model of [CLAUDE_HAIKU]) {
          try {
            const response = await anthropic.messages.create({
              model,
              max_tokens: 4096,
              messages: [
                {
                  role: "user",
                  content: [
                    contentBlock,
                    { type: "text", text: EXTRACTION_PROMPT },
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

  return { attachments, updated };
}
