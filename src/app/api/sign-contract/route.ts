import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { notifyTeamOfContractSignature } from "@/lib/notifications/contract-signed";
import { resolveContractTotal } from "@/lib/contracts/contract-lock";
import { z } from "zod";

export const runtime = "nodejs";

const signSchema = z.object({
  token: z.string().min(20).max(200),
  signature: z.string().trim().min(2).max(200),
});

// Public surface — service role, no auth. Mirrors approve-change-order.
function getPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** GET: load the contract by token (public, no auth) + track the view. */
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const supabase = getPublicClient();

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, project_number, address, city, state, zip, scope_of_work, contract_status, contract_client_signature, contract_client_signed_at, contract_client_viewed_at, contract_client_view_count, contract_countersigned_at, contract_countersigned_signature, contract_locked_amount, customers(first_name, last_name)")
    .eq("contract_token", token)
    .single();

  if (error || !project) {
    return NextResponse.json({ error: "Contract not found or invalid link" }, { status: 404 });
  }

  await supabase
    .from("projects")
    .update({
      contract_client_viewed_at: project.contract_client_viewed_at || new Date().toISOString(),
      contract_client_view_count: (project.contract_client_view_count || 0) + 1,
      contract_status: project.contract_client_signed_at
        ? project.contract_status
        : "viewed",
    })
    .eq("id", project.id);

  const { total } = await resolveContractTotal(supabase, project.id);

  const { data: milestones } = await supabase
    .from("project_payment_milestones")
    .select("label, percent, amount, sort_order")
    .eq("project_id", project.id)
    .order("sort_order");

  const schedule = (milestones ?? []).map((m) => ({
    label: m.label,
    amount:
      m.amount != null
        ? Number(m.amount)
        : Math.round(((total * Number(m.percent ?? 0)) / 100) * 100) / 100,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const custArr = project.customers as any;
  const cust = Array.isArray(custArr) ? custArr[0] : custArr;

  return NextResponse.json({
    project_id: project.id,
    project_name: project.name || "",
    project_number: project.project_number || "",
    project_address: [project.address, project.city, project.state, project.zip]
      .filter(Boolean)
      .join(", "),
    client_name: cust ? `${cust.first_name} ${cust.last_name}` : "",
    scope_of_work: project.scope_of_work || "",
    contract_total: total,
    schedule,
    client_signature: project.contract_client_signature,
    client_signed_at: project.contract_client_signed_at,
    countersigned_at: project.contract_countersigned_at,
    countersigned_signature: project.contract_countersigned_signature,
  });
}

/**
 * POST: the client signs (public, no auth).
 *
 * This does NOT lock the money — a contract is not executed until Penney
 * countersigns. That happens in-app via countersignContract().
 */
export async function POST(request: NextRequest) {
  const parsed = signSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid token and signature required" }, { status: 400 });
  }
  const { token, signature } = parsed.data;

  const supabase = getPublicClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, contract_client_signature")
    .eq("contract_token", token)
    .single();

  if (!project) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  if (project.contract_client_signature) {
    return NextResponse.json({ error: "Already signed" }, { status: 400 });
  }

  const ip =
    request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
  const signedAt = new Date().toISOString();

  const { data: signed, error } = await supabase
    .from("projects")
    .update({
      contract_client_signature: signature,
      contract_client_signed_at: signedAt,
      contract_client_ip: ip,
      contract_status: "client_signed",
      updated_at: signedAt,
    })
    .eq("id", project.id)
    .is("contract_client_signature", null)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!signed) return NextResponse.json({ error: "Already signed" }, { status: 409 });

  // Snapshot the signed PDF. Not critical — the signature is already recorded.
  try {
    const { data: keyRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "proposal_pdf_service_key")
      .maybeSingle();
    const serviceKey = String(keyRow?.value ?? "");
    if (serviceKey) {
      const pdfRes = await fetch(
        `${request.nextUrl.origin}/api/generate-contract?projectId=${project.id}`,
        { headers: { "x-service-key": serviceKey } },
      );
      if (pdfRes.ok) {
        const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
        const storagePath = `contracts/${project.id}/signed-contract.pdf`;
        await supabase.storage
          .from("email-attachments")
          .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
        await supabase
          .from("projects")
          .update({ contract_signed_pdf_path: storagePath })
          .eq("id", project.id);
      }
    }
  } catch { /* PDF snapshot is not critical — the signature stands */ }

  // Change orders notify nobody when a client signs; the team finds out next
  // time somebody opens the Finances tab. Not repeating that here.
  try {
    await notifyTeamOfContractSignature({
      projectId: project.id,
      projectName: project.name || project.project_number || "a project",
      signerName: signature,
    });
  } catch (e) {
    console.error("Contract signature notification failed:", e);
  }

  return NextResponse.json({
    success: true,
    message: `Contract signed by ${signature}. Penney Construction will countersign and send you a fully executed copy.`,
  });
}
