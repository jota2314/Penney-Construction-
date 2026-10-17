import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSubAccess } from "@/lib/sub-portal/access";
import { subAgreementsEnabled } from "@/lib/sub-portal/flags";
import { refuseStaffBrowser } from "@/lib/sub-portal/staff-guard";
import type { SubActionResponse, SubAgreementDetail, SubAgreementSummary, SubNeededSignAgreement } from "@/lib/sub-portal/payload";
import { notifySubAgreementSigned } from "@/lib/notifications/sub-field-notify";
import { sha256Hex } from "@/lib/pdf/penney-doc";
import { renderAgreementPdf } from "@/lib/subs/agreement-pdf";
import {
  getOfficeViewerId,
  isVisibleToSub,
  listSubAgreementSummaries,
  loadAgreementBundle,
  readStoredFile,
  sentPdfPath,
  signAgreementNeededItems,
  signedPdfPath,
  storeFile,
  subSignBlockers,
  toSubAgreementDetail,
} from "@/lib/subs/agreements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The sub's agreements (plan §5.4). Signing happens only inside a portal
 * login; there is no public sign link.
 *
 * GET                       → { ok, agreements, needed }     his list (cookie)
 * GET ?id=                  → { ok, agreement }              the sign sheet (cookie); stamps the view
 * GET ?id=&preview=1        → { ok, agreement }              staff read-only preview: no stamps, can_sign false
 * GET ?preview=1&subId=     → { ok, agreements, needed }     staff preview of his list
 * POST {action:"sign", id, name, consent:true, pdfSha256, consentedAt?}
 *
 * The view is stamped only for a real sub session: never in preview, and
 * never from a browser that also carries a Penney staff login.
 */

type ListResponse = SubActionResponse<{ agreements: SubAgreementSummary[]; needed: SubNeededSignAgreement[] }>;
type DetailResponse = SubActionResponse<{ agreement: SubAgreementDetail }>;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const admin = createAdminClient();

  if (url.searchParams.get("preview") === "1") {
    if (!(await getOfficeViewerId())) {
      return NextResponse.json<DetailResponse>({ error: "Staff preview needs a Penney login." }, { status: 401 });
    }
    if (id) {
      const bundle = await loadAgreementBundle(admin, id);
      if (!bundle) return NextResponse.json<DetailResponse>({ error: "Agreement not found" }, { status: 404 });
      return NextResponse.json<DetailResponse>({ ok: true, agreement: toSubAgreementDetail(bundle, { mode: "preview", role: "owner" }) });
    }
    const subId = url.searchParams.get("subId");
    if (!subId) return NextResponse.json<ListResponse>({ error: "subId required" }, { status: 400 });
    const agreements = await listSubAgreementSummaries(admin, { subId, mode: "preview" });
    return NextResponse.json<ListResponse>({ ok: true, agreements, needed: signAgreementNeededItems(agreements) });
  }

  // Off switch (NEXT_PUBLIC_SUB_AGREEMENTS=0): same as the portal loader, an
  // empty list, and no sign sheet or view stamp.
  if (!subAgreementsEnabled()) {
    if (!id) return NextResponse.json<ListResponse>({ ok: true, agreements: [], needed: [] });
    return NextResponse.json<DetailResponse>({ error: "Agreement not found" }, { status: 404 });
  }

  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  if (!id) {
    const agreements = await listSubAgreementSummaries(admin, { subId: access.subId, mode: "sub" });
    return NextResponse.json<ListResponse>({ ok: true, agreements, needed: signAgreementNeededItems(agreements) });
  }

  const bundle = await loadAgreementBundle(admin, id);
  if (!bundle || bundle.agreement.subcontractor_id !== access.subId || !isVisibleToSub(bundle.agreement)) {
    return NextResponse.json<DetailResponse>({ error: "Agreement not found" }, { status: 404 });
  }

  // He opened it: first view, count, and "Opened by the sub" for the office.
  const a = bundle.agreement;
  const staffBrowser = (await refuseStaffBrowser(request)) !== null;
  if (!staffBrowser && (a.status === "sent" || a.status === "viewed")) {
    const now = new Date().toISOString();
    const { data: stamped } = await admin
      .from("sub_agreements")
      .update({ status: "viewed", first_viewed_at: a.first_viewed_at ?? now, view_count: (a.view_count ?? 0) + 1 })
      .eq("id", a.id)
      .in("status", ["sent", "viewed"])
      .select("status, first_viewed_at, view_count")
      .maybeSingle();
    if (stamped) {
      bundle.agreement = { ...a, status: stamped.status, first_viewed_at: stamped.first_viewed_at, view_count: stamped.view_count };
    }
  }
  return NextResponse.json<DetailResponse>({ ok: true, agreement: toSubAgreementDetail(bundle, { mode: "sub", role: "owner" }) });
}

const signSchema = z.object({
  action: z.literal("sign"),
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  consent: z.literal(true),
  /** The SHA-256 of the copy he was shown (SubAgreementDetail.pdf_sha256). */
  pdfSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** When he ticked the consent box; only kept if it is within the last day. */
  consentedAt: z.string().datetime().optional(),
});

type SignResponse = SubActionResponse<{ number: string; signed_at: string }>;

export async function POST(request: NextRequest) {
  const refused = await refuseStaffBrowser(request);
  if (refused) return refused;
  // The off switch holds on the server too, not only in the portal's UI.
  if (!subAgreementsEnabled()) return NextResponse.json<SignResponse>({ error: "Signing is paused right now. Call the office." }, { status: 403 });

  const access = await resolveSubAccess(request);
  if (!access) return NextResponse.json<SignResponse>({ error: "Please sign in again." }, { status: 401 });

  const raw = await request.json().catch(() => null);
  if (raw?.action === "sign" && raw?.consent !== true) {
    return NextResponse.json<SignResponse>({ error: "Tick the box to agree to sign electronically." }, { status: 400 });
  }
  const parsed = signSchema.safeParse(raw);
  if (!parsed.success) {
    const nameShort = typeof raw?.name === "string" && raw.name.trim().length < 2;
    return NextResponse.json<SignResponse>({ error: nameShort ? "Type your full name to sign." : "Something was missing. Close this and try again." }, { status: 400 });
  }
  const input = parsed.data;

  const admin = createAdminClient();
  const bundle = await loadAgreementBundle(admin, input.id);
  if (!bundle || bundle.agreement.subcontractor_id !== access.subId || !isVisibleToSub(bundle.agreement)) {
    return NextResponse.json<SignResponse>({ error: "Agreement not found" }, { status: 404 });
  }
  // R1: every portal login is the company owner, who may bind the company.
  // R2 adds worker logins, which never sign (they get no access here).
  const a = bundle.agreement;
  if (a.status === "signed") return NextResponse.json<SignResponse>({ error: "This is already signed." }, { status: 409 });
  const blockers = subSignBlockers(bundle);
  if (blockers.length) return NextResponse.json<SignResponse>({ error: blockers[0] }, { status: 409 });

  // He signs exactly the copy Penney stored when it signed: the hash he was
  // shown, the hash on the row, and the stored file all have to agree.
  if (input.pdfSha256 !== a.pdf_sha256) {
    return NextResponse.json<SignResponse>({ error: "This document changed since you opened it. Close it and open it again." }, { status: 409 });
  }
  const stored = await readStoredFile(admin, sentPdfPath(a.id));
  if (!stored || sha256Hex(stored) !== a.pdf_sha256) {
    console.error("[sub-portal/agreements] sent copy missing or changed for", a.number);
    return NextResponse.json<SignResponse>({ error: "This document isn't ready to sign yet. Penney will send it again." }, { status: 409 });
  }

  const { data: login } = await admin.from("sub_portal_access").select("phone_login").eq("id", access.accessId).maybeSingle();
  const now = new Date();
  const consentAt = input.consentedAt && Date.parse(input.consentedAt) <= now.getTime() && Date.parse(input.consentedAt) > now.getTime() - 86_400_000
    ? new Date(input.consentedAt).toISOString()
    : now.toISOString();
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  const signedAt = now.toISOString();

  // One signature, ever: the update only lands while nobody has signed.
  const { data: signed, error } = await admin
    .from("sub_agreements")
    .update({
      status: "signed",
      sub_signed_name: input.name,
      sub_signed_at: signedAt,
      sub_signed_ip: ip,
      sub_signed_ua: (request.headers.get("user-agent") ?? "").slice(0, 400) || null,
      sub_signed_access_id: access.accessId,
      sub_signed_phone: (login?.phone_login as string | null | undefined) ?? null,
      esign_consent_at: consentAt,
    })
    .eq("id", a.id)
    .eq("subcontractor_id", access.subId)
    .in("status", ["sent", "viewed"])
    .eq("pdf_sha256", a.pdf_sha256)
    .is("sub_signed_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[sub-portal/agreements] sign failed", error.message);
    return NextResponse.json<SignResponse>({ error: "Couldn't save your signature. Try again." }, { status: 500 });
  }
  if (!signed) return NextResponse.json<SignResponse>({ error: "This is already signed." }, { status: 409 });

  // The executed copy: his signature plus the e-signature record. Not
  // critical to the signature itself, which is already recorded.
  try {
    const fresh = await loadAgreementBundle(admin, a.id);
    if (fresh) {
      const pdf = renderAgreementPdf(fresh, { includeSubSignature: true });
      const path = signedPdfPath(a.id);
      const storeError = await storeFile(admin, path, pdf, "application/pdf");
      if (storeError) console.error("[sub-portal/agreements] executed copy not stored", storeError);
      else await admin.from("sub_agreements").update({ signed_pdf_path: path }).eq("id", a.id);
    }
  } catch (e) {
    console.error("[sub-portal/agreements] executed copy failed", e instanceof Error ? e.message : String(e));
  }

  // Lock the job's contract amount to the signed work (the amendment path).
  if (a.project_id && a.kind !== "master") {
    const { error: syncError } = await admin.rpc("sync_sub_contract", { p_project: a.project_id, p_sub: a.subcontractor_id });
    if (syncError) console.error("[sub-portal/agreements] sync_sub_contract failed after signing", a.number, syncError.message);
  }

  after(() =>
    notifySubAgreementSigned({
      agreementId: a.id,
      subId: a.subcontractor_id,
      projectId: a.project_id,
      number: a.number,
      kind: a.kind,
      signedName: input.name,
    }),
  );

  return NextResponse.json<SignResponse>({ ok: true, number: a.number, signed_at: signedAt });
}
