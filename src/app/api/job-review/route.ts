import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCorrection, inspectFinding, previewCorrection, reviewJob, saveEvidence } from "@/lib/job-review/service";

export const maxDuration = 60;
const uuid = z.string().uuid();
const project = { project_id: uuid };
const inputs = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_job_review"), ...project }).strict(),
  z.object({ action: z.literal("inspect_job_finding"), ...project, run_id: uuid, finding_id: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal("preview_job_correction"), ...project, kind: z.enum(["invoice_allocation", "labor_allocation"]), record_id: uuid, target_line_id: uuid, reason: z.string().trim().min(8).max(2000), evidence_refs: z.array(z.string().min(1).max(1000)).min(1).max(50) }).strict(),
  z.object({ action: z.literal("apply_job_correction"), ...project, preview_id: uuid, authorized: z.literal(true) }).strict(),
  z.object({ action: z.literal("save_job_review_evidence"), ...project, run_id: uuid, title: z.string().trim().min(1).max(2000), action_needed: z.string().trim().min(1).max(300), classification: z.enum(["allocation_question", "verified_cost", "question"]), line_id: uuid.nullable(), refs: z.array(z.string().min(1).max(1000)).min(1).max(100), resolved: z.boolean().default(false), priority: z.number().int().min(1).max(3).default(2), supersedes_id: uuid.optional() }).strict(),
]);
export async function POST(request: NextRequest) {
  try {
    const admin = createAdminClient();
    let actor: string;
    const supplied = request.headers.get("x-service-key");
    if (supplied !== null) {
      const { data, error } = await admin.from("app_settings").select("value").eq("key", "proposal_pdf_service_key").single();
      const expected = Buffer.from(String(data?.value ?? "")), actual = Buffer.from(supplied);
      if (error || !expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const parsed = uuid.safeParse(request.headers.get("x-penney-actor"));
      if (!parsed.success) return NextResponse.json({ error: "Verified caller required" }, { status: 401 });
      actor = parsed.data;
    } else {
      // Browser writes are same-origin and use the real authenticated identity.
      if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Same-origin request required" }, { status: 403 });
      const user = await getUser();
      if (!user || user.isImpersonating) return NextResponse.json({ error: "Sign in with your own office account to review financials" }, { status: 401 });
      actor = user.id;
    }
    const { error: denied } = await admin.rpc("job_review_require_actor", { p_actor_id: actor });
    if (denied) return NextResponse.json({ error: "Office financial access required" }, { status: 403 });
    const input = inputs.parse(await request.json());
    let result;
    switch (input.action) {
      case "get_job_review": result = await reviewJob(actor, input.project_id); break;
      case "inspect_job_finding": result = await inspectFinding(actor, input.project_id, input.run_id, input.finding_id); break;
      case "preview_job_correction": result = await previewCorrection(actor, input.project_id, input); break;
      case "apply_job_correction": result = await applyCorrection(actor, input.project_id, input.preview_id); break;
      case "save_job_review_evidence": result = await saveEvidence(actor, input.project_id, input.run_id, { title: input.title, action: input.action_needed, classification: input.classification, line_id: input.line_id, refs: input.refs, resolved: input.resolved, priority: input.priority, supersedes_id: input.supersedes_id }); break;
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid review request", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Review failed; no complete result is available." }, { status: 409 });
  }
}
