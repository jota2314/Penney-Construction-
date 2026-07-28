import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushProjectToQuickBooks } from "@/lib/quickbooks/customers";
import { z } from "zod";

export const runtime = "nodejs";

/**
 * Mirror a project into QuickBooks as Customer + sub-customer Job.
 *
 * createProject already calls pushProjectToQuickBooks inline, but that only
 * covers projects made through the New Project form. Projects created any
 * other way — a SQL insert, an import, the assistant creating one on Jorge's
 * behalf — never touched QuickBooks, and syncProjectToQuickBooks (the intended
 * backfill) was written but wired to no button. Result: 98 of 107 projects had
 * no QuickBooks link.
 *
 * This exposes the same push over HTTP so it can be called after a project is
 * created by any route, and used to backfill the ones that were missed.
 *
 * pushProjectToQuickBooks is idempotent — it early-returns when the project
 * already carries a quickbooks_customer_id, and find-or-creates both the
 * parent Customer and the Job — so re-running this is safe.
 */
const requestSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    /** Backfill several at once. Capped so a typo can't fan out over the whole table. */
    projectIds: z.array(z.string().uuid()).min(1).max(50).optional(),
  })
  .refine((v) => v.projectId || v.projectIds, {
    message: "projectId or projectIds is required",
  });

export async function POST(request: NextRequest) {
  // Two auth paths, same as generate-contract: a signed-in user, or the shared
  // service key for headless callers.
  const serviceKey = request.headers.get("x-service-key");
  if (serviceKey) {
    const admin = createAdminClient();
    const { data: keyRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "proposal_pdf_service_key")
      .maybeSingle();
    const expected = String(keyRow?.value ?? "");
    const a = Buffer.from(serviceKey);
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "Invalid service key" }, { status: 401 });
    }
  } else {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "projectId or projectIds is required" },
      { status: 400 },
    );
  }

  const ids = parsed.data.projectIds ?? [parsed.data.projectId as string];

  // Sequential on purpose. Two projects for the same client would otherwise
  // race to create the parent Customer and QuickBooks would reject the second
  // as a duplicate DisplayName.
  const results: { projectId: string; qbJobId?: string; error: string | null }[] = [];
  for (const id of ids) {
    try {
      const r = await pushProjectToQuickBooks(id);
      results.push({ projectId: id, qbJobId: r.qbJobId, error: r.error });
    } catch (e) {
      results.push({
        projectId: id,
        error: e instanceof Error ? e.message : "QuickBooks push failed",
      });
    }
  }

  const pushed = results.filter((r) => !r.error).length;
  const failed = results.length - pushed;

  return NextResponse.json({
    success: failed === 0,
    pushed,
    failed,
    results,
  });
}
