import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { attachReceiptToCapture } from "@/lib/actions/field-capture";

// Saving is a separate request from AI reading: a model timeout cannot
// prevent attachment, or hide the file from Saved uploads.
export async function POST(request: NextRequest) {
  const user = await getUser();
  const owner = user?.profile?.id ?? user?.id;
  if (!owner) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const supabase = await createClient();
  const bucket = supabase.storage.from("field-captures");
  try {
    const input = await request.json();
    if (input.action === "prepare") {
      if (!(input.type?.startsWith("image/") || input.type === "application/pdf") ||
          !Number.isFinite(input.size) || input.size <= 0 || input.size > 25 * 1024 * 1024) {
        return NextResponse.json({ error: "Choose a non-empty photo or PDF under 25 MB." }, { status: 400 });
      }
      const name = String(input.name || "receipt").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
      const path = `${owner}/${crypto.randomUUID()}-${name}`;
      const { data, error } = await bucket.createSignedUploadUrl(path);
      if (error) throw error;
      return NextResponse.json({ path, token: data.token });
    }
    const path = String(input.path ?? "");
    if (input.action !== "finish" || !path.startsWith(`${owner}/`) || path.includes("..")) {
      return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
    }
    const { data, error } = await bucket.info(path);
    if (error || !data) throw new Error("File save could not be verified. Please retry.");
    if (input.invoiceId) {
      const result = await attachReceiptToCapture({ invoiceId: input.invoiceId, storagePath: path });
      if (result.error) {
        return NextResponse.json({ saved: true, path,
          error: `File saved in Saved uploads, but could not attach to this transaction: ${result.error}` }, { status: 409 });
      }
    }
    return NextResponse.json({ saved: true, path });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save upload" }, { status: 500 });
  }
}
