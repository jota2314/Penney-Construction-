import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSubAccess } from "@/lib/sub-portal/access";
import { renderAgreementPdf } from "@/lib/subs/agreement-pdf";
import {
  getOfficeViewerId,
  isVisibleToSub,
  loadAgreementBundle,
  readStoredFile,
  sentPdfPath,
} from "@/lib/subs/agreements";

export const runtime = "nodejs";
// Never a cached PDF: the same URL shows the draft, the sent copy and then
// the executed copy as the agreement moves along.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SCAN_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
};

/**
 * GET /api/generate-sub-agreement?id= — the PDF of a sub agreement (plan §5.4).
 *
 * Three ways in, like generate-contract:
 *  1. the shared `x-service-key` header (app_settings proposal_pdf_service_key),
 *     compared timing-safe; for headless fetches (Penney MCP)
 *  2. a signed-in office user (owner, precon, PM, office admin)
 *  3. the sub's portal cookie, and only for his own agreement once it has
 *     been sent to him (never a draft)
 *
 * What it returns:
 *  - signed on paper: the scan the office filed
 *  - signed in the portal: the stored executed copy
 *  - sent (or signed by Penney, not yet sent): the stored sent copy, the exact
 *    bytes whose SHA-256 the sub signs against
 *  - otherwise a fresh render; "DRAFT - NOT FOR SIGNATURE" across every page
 *    while the template isn't approved or it's still a draft, "VOID" once voided
 */
export async function GET(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const admin = createAdminClient();

    let subId: string | null = null;
    const serviceKey = request.headers.get("x-service-key");
    if (serviceKey) {
      const { data: keyRow } = await admin.from("app_settings").select("value").eq("key", "proposal_pdf_service_key").maybeSingle();
      const expected = String(keyRow?.value ?? "");
      const a = Buffer.from(serviceKey);
      const b = Buffer.from(expected);
      if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return NextResponse.json({ error: "Invalid service key" }, { status: 401 });
      }
    } else if (!(await getOfficeViewerId())) {
      const access = await resolveSubAccess(request);
      if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
      subId = access.subId;
    }

    const bundle = await loadAgreementBundle(admin, id);
    // A sub asking for someone else's agreement, or one not sent to him yet,
    // gets the same answer as a missing one.
    if (!bundle || (subId && (bundle.agreement.subcontractor_id !== subId || !isVisibleToSub(bundle.agreement)))) {
      return NextResponse.json({ error: "Agreement not found" }, { status: 404 });
    }
    const a = bundle.agreement;
    const filename = `${a.number} - ${bundle.sub.company_name}`;

    let body: Buffer | null = null;
    let contentType = "application/pdf";
    let ext = "pdf";
    const voided = a.status === "void" || a.status === "superseded";

    if (!voided && a.signed_pdf_path) {
      body = await readStoredFile(admin, a.signed_pdf_path);
      ext = a.signed_pdf_path.split(".").pop()?.toLowerCase() ?? "pdf";
      contentType = SCAN_TYPES[ext] ?? "application/octet-stream";
    }
    if (!body && !voided && a.pdf_sha256 && !a.sub_signed_at) {
      body = await readStoredFile(admin, sentPdfPath(a.id));
      ext = "pdf";
      contentType = "application/pdf";
    }
    if (!body) {
      body = renderAgreementPdf(bundle, { includeSubSignature: a.status === "signed" || (voided && !!a.sub_signed_at) });
      ext = "pdf";
      contentType = "application/pdf";
    }

    const full = `${filename}.${ext}`;
    const asciiName = full.replace(/[^\x20-\x7E]/g, "-").replace(/"/g, "");
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(full)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[generate-sub-agreement] crashed:", err);
    return NextResponse.json({ error: "Couldn't make the PDF", where: "generate-sub-agreement" }, { status: 500 });
  }
}
