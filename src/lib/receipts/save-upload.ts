import { createClient } from "@/lib/supabase/client";

/** Save and verify the document before starting a separate AI request.
 * Direct signed storage upload avoids the app server's 4.5 MB request cap.
 * The immutable object is also the durable Saved uploads record.
 */
export async function saveReceiptUpload(body: FormData, invoiceId?: string): Promise<string | null> {
  const file = body.get("file");
  if (!(file instanceof File)) return String(body.get("storagePath") || "") || null;
  const prepared = await fetch("/api/receipts/upload", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare", name: file.name, type: file.type, size: file.size }),
  });
  const upload = await prepared.json();
  if (!prepared.ok) throw new Error(upload.error || "Could not start upload");
  const { error } = await createClient().storage.from("field-captures")
    .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type });
  if (error) throw new Error(`Upload was not confirmed: ${error.message}. Check Saved uploads before retrying.`);
  // Keep the saved path even if the final verification request loses signal.
  body.delete("file");
  body.set("storagePath", upload.path);
  const finished = await fetch("/api/receipts/upload", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "finish", path: upload.path, invoiceId }),
  });
  const result = await finished.json();
  if (!finished.ok) throw new Error(result.error || "File saved; attachment could not be confirmed. Check Saved uploads.");
  return upload.path;
}

export function savedUploadError(body: FormData, message: string): string {
  return body.get("storagePath")
    ? `The file is saved in Saved uploads. ${message}`
    : message;
}
