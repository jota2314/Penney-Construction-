import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { notifyClientPaymentCaptured } from "@/lib/notifications/tagged-mentions";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "field-captures";

/**
 * FILE a client payment, after a human confirmed the read. The scan route
 * proposes; this route is the only one that writes money IN.
 *
 * Accepts two shapes:
 *   scanned -- storagePath from /api/deposits/capture, photo kept on the row
 *   manual  -- no photo at all, for a wire or Zelle with no paper to shoot
 *
 * As on the receipt side, the client posts back the read it was shown. The
 * app's RLS posture is already "any signed-in user sees everything", so
 * re-running the vision call to defend against a Penney employee editing a
 * number would buy nothing. What IS enforced here: the photo must belong to
 * the caller, the job must exist, and the amount must be a real positive
 * number -- a zero or negative "payment" would corrupt the job's received
 * total exactly the way a $0 invoice corrupts Spent.
 */

const METHODS = new Set(["check", "wire", "ach", "credit_card", "cash", "zelle", "other"]);
const PAYMENT_TYPES = new Set([
  "deposit",
  "draw",
  "progress",
  "final",
  "change_order",
  "retainage",
  "other",
]);

const round2 = (n: number): number => Math.round(n * 100) / 100;

export async function POST(request: NextRequest) {
  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id;
  if (!profileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = await createClient();

  try {
    const body = await request.json();
    const storagePath = String(body?.storagePath ?? "").trim();
    const projectId = String(body?.projectId ?? "").trim();

    if (!projectId) {
      return NextResponse.json({ error: "Missing job" }, { status: 400 });
    }
    // The path is namespaced by profile at upload time, so this is also the
    // check that one person can't file another person's photo. A manual entry
    // has no photo and skips it.
    if (storagePath && !storagePath.startsWith(`${profileId}/`)) {
      return NextResponse.json({ error: "Not your capture" }, { status: 403 });
    }

    const rawAmount = body?.amount;
    const amount =
      typeof rawAmount === "number" && Number.isFinite(rawAmount) ? round2(rawAmount) : null;
    if (amount === null || amount <= 0) {
      return NextResponse.json(
        { error: "Enter the amount before filing this payment" },
        { status: 400 },
      );
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, project_number")
      .eq("id", projectId)
      .single();
    if (!project) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const projectLabel = project.project_number
      ? `${project.project_number} ${project.name}`
      : project.name;

    const receivedDate =
      typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : new Date().toISOString().slice(0, 10);

    const rawType = String(body?.paymentType ?? "");
    const paymentType = PAYMENT_TYPES.has(rawType) ? rawType : "other";

    const rawMethod = String(body?.method ?? "");
    const method = METHODS.has(rawMethod) ? rawMethod : null;

    const payerName = String(body?.payer ?? "").trim() || null;
    const checkNumber = String(body?.checkNumber ?? "").trim() || null;
    const memo = String(body?.memo ?? "").trim() || null;

    const reviewReasons: string[] = [];
    if (body?.lowConfidence) reviewReasons.push("AI was not confident reading the check");
    if (!payerName) reviewReasons.push("payer name unreadable");
    if (body?.jobGuessed) reviewReasons.push("the job was guessed from the check, not chosen");
    const reviewReason = reviewReasons.length > 0 ? reviewReasons.join("; ") : null;

    const description =
      memo ||
      [payerName, checkNumber ? `check #${checkNumber}` : null].filter(Boolean).join(" ") ||
      "Client payment";

    const { data: payment, error: paymentError } = await supabase
      .from("payments_received")
      .insert({
        project_id: projectId,
        payment_type: paymentType,
        amount,
        received_date: receivedDate,
        method,
        reference_number: checkNumber,
        payer_name: payerName,
        description,
        notes: memo,
        photo_storage_path: storagePath || null,
        photo_bucket: storagePath ? BUCKET : null,
        extracted_text:
          typeof body?.extractedText === "string" ? body.extractedText.slice(0, 50000) : null,
        source: storagePath ? "deposit_capture" : "manual_entry",
        review_status: reviewReason ? "needs_review" : "ok",
        review_reason: reviewReason,
        created_by: profileId,
      })
      .select("id")
      .single();

    if (paymentError) {
      return NextResponse.json({ error: paymentError.message }, { status: 500 });
    }

    // Notification must never break the capture — the payment is already filed.
    try {
      const admin = createAdminClient();
      const { data: actor } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", profileId)
        .maybeSingle();

      // Re-read the stored photo so the email can show the check. Server to
      // server inside the same region, and only on the confirm step.
      let photo: { base64: string; mimeType: string } | null = null;
      if (storagePath) {
        const { data: blob } = await supabase.storage.from(BUCKET).download(storagePath);
        if (blob) {
          photo = {
            base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
            mimeType: blob.type || "image/jpeg",
          };
        }
      }

      await notifyClientPaymentCaptured({
        actorId: profileId,
        actorName: actor?.full_name || "Someone",
        paymentId: payment.id,
        payerName: payerName || "a client",
        amount,
        paymentType,
        projectLabel,
        reviewReason,
        url: reviewReason ? "/payments/review" : `/projects/${projectId}?tab=finances`,
        photo,
      });
    } catch (err) {
      console.error("[deposit-capture] notification failed", {
        paymentId: payment.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json({
      status: "filed",
      paymentId: payment.id,
      payer: payerName,
      amount,
      paymentType,
      project: projectLabel,
      needsReview: Boolean(reviewReason),
      reviewReason,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
