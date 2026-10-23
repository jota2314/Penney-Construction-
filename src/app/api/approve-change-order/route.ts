import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { changeOrderApprovalError, isTimeAndMaterials } from "@/lib/change-orders/billing";
import { createHash } from "crypto";

export const runtime = "nodejs";
const approvalSchema = z.object({
  token: z.string().min(20).max(200),
  signature: z.string().trim().min(2).max(200),
  version: z.string().regex(/^[a-f0-9]{64}$/),
});

// Sign only the exact scope and billing basis that the client reviewed.
function approvalVersion(co: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify([
    co.id, co.title, co.description, co.billing_type, co.tm_terms,
    co.price_impact, co.status, co.sent_to_client_at, co.updated_at,
  ])).digest("hex");
}

// Use service role for public access (no auth required)
function getPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET: Load change order by approval token (public, no auth)
 */
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const supabase = getPublicClient();

  const { data: co, error } = await supabase
    .from("change_orders")
    .select("id, change_order_number, title, description, status, price_impact, billing_type, tm_terms, sent_to_client_at, updated_at, client_signature, client_signed_at, client_viewed_at, client_view_count, project_id, projects(name, project_number, address, city, state, contract_value)")
    .eq("approval_token", token)
    .single();

  if (error || !co) return NextResponse.json({ error: "Change order not found or invalid link" }, { status: 404 });
  if (co.status !== "approved") {
    const approvalError = changeOrderApprovalError(co);
    if (approvalError) return NextResponse.json({ error: approvalError }, { status: 409 });
  }

  // Track view — set first viewed timestamp + increment count
  await supabase
    .from("change_orders")
    .update({
      client_viewed_at: co.client_viewed_at || new Date().toISOString(),
      client_view_count: (co.client_view_count || 0) + 1,
    })
    .eq("id", co.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proj = co.projects as any;

  // Get sum of other approved COs
  const { data: otherCOs } = await supabase
    .from("change_orders")
    .select("price_impact, billing_type")
    .eq("project_id", co.project_id)
    .eq("status", "approved")
    .neq("id", co.id);

  const approvedTotal = (otherCOs || []).filter((c) => !isTimeAndMaterials(c)).reduce((s, c) => s + Number(c.price_impact), 0);

  return NextResponse.json({
    id: co.id,
    change_order_number: co.change_order_number,
    title: co.title,
    description: co.description,
    status: co.status,
    price_impact: Number(co.price_impact),
    billing_type: co.billing_type,
    tm_terms: co.tm_terms,
    has_time_materials: isTimeAndMaterials(co) || (otherCOs || []).some(isTimeAndMaterials),
    approval_version: approvalVersion(co),
    client_signature: co.client_signature,
    client_signed_at: co.client_signed_at,
    project_name: proj?.name || "",
    project_number: proj?.project_number || "",
    project_address: [proj?.address, proj?.city, proj?.state].filter(Boolean).join(", "),
    contract_value: Number(proj?.contract_value || 0),
    approved_cos_total: approvedTotal,
  });
}

/**
 * POST: Client approves and signs the change order (public, no auth)
 */
export async function POST(request: NextRequest) {
  const parsed = approvalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid token, signature, and reviewed version required. Reload the change order." }, { status: 400 });
  }
  const { token, signature, version } = parsed.data;

  const supabase = getPublicClient();

  // Find the CO
  const { data: co } = await supabase
    .from("change_orders")
    .select("id, title, description, price_impact, status, client_signature, billing_type, tm_terms, sent_to_client_at, updated_at")
    .eq("approval_token", token)
    .single();

  if (!co) return NextResponse.json({ error: "Change order not found" }, { status: 404 });
  if (co.client_signature) return NextResponse.json({ error: "Already signed" }, { status: 400 });
  const approvalError = changeOrderApprovalError(co);
  if (approvalError) return NextResponse.json({ error: approvalError }, { status: 409 });
  if (version !== approvalVersion(co)) {
    return NextResponse.json({ error: "The change order changed since you opened it. Reload and review the current scope and billing terms before signing." }, { status: 409 });
  }

  // Get client IP
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

  const signedAt = new Date().toISOString();

  // Approve it
  const { data: approved, error } = await supabase
    .from("change_orders")
    .update({
      status: "approved",
      approved_at: signedAt,
      approved_by: signature,
      client_signature: signature,
      client_signed_at: signedAt,
      client_ip: ip,
    })
    .eq("id", co.id)
    .eq("status", "submitted")
    .eq("updated_at", co.updated_at)
    .eq("sent_to_client_at", co.sent_to_client_at)
    .is("client_signature", null)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!approved) return NextResponse.json({ error: "This change order changed or was already signed. Reload it before approving." }, { status: 409 });

  // Generate signed PDF and save to storage
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) throw new Error("Service role key is not configured");
    const pdfRes = await fetch(
      `${request.nextUrl.origin}/api/generate-change-order?changeOrderId=${co.id}`,
      { headers: { authorization: `Bearer ${serviceKey}` } }
    );
    if (pdfRes.ok) {
      const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
      const storagePath = `change-orders/${co.id}/signed-co.pdf`;
      await supabase.storage
        .from("email-attachments")
        .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

      // Save the storage path on the CO
      await supabase
        .from("change_orders")
        .update({ attachment_storage_path: storagePath })
        .eq("id", co.id);
    }
  } catch { /* PDF save is not critical — approval still recorded */ }

  return NextResponse.json({ success: true, message: `Change Order approved by ${signature}` });
}
