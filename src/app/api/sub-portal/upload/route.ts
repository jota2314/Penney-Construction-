import { NextRequest, NextResponse } from "next/server";
import { resolveSubAccess, getSubProjectIds } from "@/lib/sub-portal/access";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";
import { readSubDocument } from "@/lib/sub-portal/bill-handoff";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/sub-portal/upload  (multipart: file, projectId, docType)
 *
 * A sub sends us their own paperwork from the portal. The vendor is never
 * guessed — it IS the signed-in sub, so the row is linked to their
 * subcontractor_id at write time (the name-only rows from email ingest are
 * exactly what broke the portal on 8/5).
 *
 *   docType "quote"   → quote_requests (status received) — shows on the
 *                       project's Subs board like any uploaded quote.
 *   docType "invoice" → refused with 410. Invoices go through the Money
 *                       tab's Send an invoice (/api/sub-portal/bills), which
 *                       hands the file to the Command Center bill workflow
 *                       instead of writing `invoices` here (AGENTS.md: vendor
 *                       bills only through that workflow). Old app shells
 *                       still post here, so they get a plain answer.
 */
export async function POST(request: NextRequest) {
  const staff = await refuseStaffBrowser(request);
  if (staff) return staff;
  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase, subId, companyName, trades } = access;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const docType = ((form.get("docType") as string) || "").trim();
  // Before anything is stored: no invoice file lands in email-attachments
  // and nothing reaches `invoices` from here.
  if (docType === "invoice") {
    return NextResponse.json({ error: "Send invoices from the Money tab" }, { status: 410 });
  }

  const file = form.get("file");
  const projectId = ((form.get("projectId") as string) || "").trim();
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!projectId) return NextResponse.json({ error: "Pick a job first" }, { status: 400 });
  if (docType !== "quote") {
    return NextResponse.json({ error: "Pick quote or invoice" }, { status: 400 });
  }

  const isPdf = file.type === "application/pdf";
  const isImage = file.type.startsWith("image/");
  if (!isPdf && !isImage) {
    return NextResponse.json({ error: "Send a PDF or a photo of the document" }, { status: 400 });
  }

  const projectIds = await getSubProjectIds(supabase, subId);
  if (!projectIds.includes(projectId)) {
    return NextResponse.json({ error: "That job isn't on your list" }, { status: 403 });
  }
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Same bucket + prefix the office quote surfaces use, so View PDF links
  // sign against the right place everywhere.
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `quote-uploads/${projectId}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("email-attachments")
    .upload(storagePath, fileBuffer, { contentType: file.type });
  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
  }

  // Read the document — the vendor is known, we only need the numbers.
  const read = await readSubDocument({
    buffer: fileBuffer,
    mime: file.type,
    docType: "quote",
    companyName,
    projectName: project.name,
    includeText: true,
  });

  const amount = read?.amount ?? null;
  const docDate = read?.date ?? new Date().toISOString().slice(0, 10);
  const extractedText = read?.extractedText ?? null;
  const trade = read?.trade || trades[0] || null;
  const summary = read?.summary ?? null;

  const { error: insertError } = await supabase
    .from("quote_requests")
    .insert({
      project_id: projectId,
      project_name: project.name,
      subcontractor_name: companyName,
      subcontractor_id: subId,
      trade,
      amount,
      scope_description: summary,
      extracted_text: extractedText,
      document_type: "quote",
      status: "received",
      sent_at: docDate,
      received_at: new Date().toISOString(),
      attachment_storage_path: storagePath,
      created_by: null,
    });
  if (insertError) {
    return NextResponse.json({ error: `Couldn't file the quote: ${insertError.message}` }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    message: amount != null
      ? `Quote received — $${amount.toLocaleString()}. We'll take a look.`
      : "Quote received. We'll take a look.",
  });
}
