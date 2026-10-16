import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  approveBillsForPayAsActor,
  listBillsAwaitingApproval,
  PayApprovalError,
} from "@/lib/finance/pay-approval-service";

/**
 * Bill pay approval for the Penney MCP. Service key + verified actor, the
 * same handshake as /api/job-review: the MCP resolves the signed-in Google
 * account to a profile id and passes it in x-penney-actor. The approver gate
 * (canApproveBillPay) runs on that actor here, never in the MCP.
 */
const uuid = z.string().uuid();
const inputs = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), project_id: uuid.optional() }).strict(),
  z.object({ action: z.literal("approve"), invoice_ids: z.array(uuid).min(1).max(25), authorized: z.literal(true) }).strict(),
]);

export async function POST(request: NextRequest) {
  try {
    const admin = createAdminClient();
    const supplied = request.headers.get("x-service-key");
    if (supplied === null) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data, error } = await admin.from("app_settings").select("value").eq("key", "proposal_pdf_service_key").single();
    const expected = Buffer.from(String(data?.value ?? "")), actual = Buffer.from(supplied);
    if (error || !expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const actor = uuid.safeParse(request.headers.get("x-penney-actor"));
    if (!actor.success) return NextResponse.json({ error: "Verified caller required" }, { status: 401 });

    const input = inputs.parse(await request.json());
    if (input.action === "list") {
      const result = await listBillsAwaitingApproval(admin, actor.data, input.project_id);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await approveBillsForPayAsActor(admin, actor.data, input.invoice_ids);
    revalidatePath("/invoices");
    revalidatePath("/spent");
    revalidatePath("/finances/daily-log");
    for (const id of result.approved_ids) revalidatePath(`/spent/${id}`);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: error.issues }, { status: 400 });
    if (error instanceof PayApprovalError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[api/bills/pay-approval]", error);
    return NextResponse.json({ error: "Pay approval failed. Check the bill in the app before retrying." }, { status: 500 });
  }
}
