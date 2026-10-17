import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import {
  addSelectionItem,
  allowanceCheck,
  draftSheetRevision,
  listSelections,
  SelectionError,
  updateSelectionItem,
  type Actor,
} from "@/lib/selections/service";

export const runtime = "nodejs";

/**
 * POST /api/selections — the selections log, for the app and the Penney MCP.
 *
 * Two ways in, one code path:
 *  - a signed-in office user (field crew refused), or
 *  - the Penney MCP: x-service-key + x-penney-actor (the verified caller's
 *    profile id), the same handshake as /api/bills/pay-approval.
 * The actor is always resolved here and written to the history row; a caller
 * can't name someone else.
 */
const uuid = z.string().uuid();
const fields = z.record(z.string(), z.unknown());
const inputs = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), project_id: uuid, include_removed: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("allowance"), project_id: uuid }).strict(),
  z.object({ action: z.literal("add"), project_id: uuid, item: fields, source: z.string().max(500).optional(), note: z.string().max(1000).optional() }).strict(),
  z.object({ action: z.literal("update"), project_id: uuid, item_id: uuid, changes: fields, source: z.string().max(500).optional(), note: z.string().max(1000).optional() }).strict(),
  z.object({ action: z.literal("draft_sheet"), project_id: uuid, title: z.string().max(200).optional(), intro: z.string().max(1000).optional() }).strict(),
]);

async function resolveActor(request: NextRequest, admin: ReturnType<typeof createAdminClient>): Promise<Actor | NextResponse> {
  const supplied = request.headers.get("x-service-key");
  if (supplied !== null) {
    const { data, error } = await admin.from("app_settings").select("value").eq("key", "proposal_pdf_service_key").single();
    const expected = Buffer.from(String(data?.value ?? "")), actual = Buffer.from(supplied);
    if (error || !expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const actorId = uuid.safeParse(request.headers.get("x-penney-actor"));
    if (!actorId.success) return NextResponse.json({ error: "Verified caller required" }, { status: 401 });
    const { data: profile } = await admin.from("profiles").select("id, full_name, email, role").eq("id", actorId.data).maybeSingle();
    if (!profile || profile.role === "field") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    return { name: profile.full_name || profile.email, profileId: profile.id };
  }
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.profile || user.profile.role === "field") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  return { name: user.profile.full_name || user.email, profileId: user.profile.id };
}

export async function POST(request: NextRequest) {
  try {
    const admin = createAdminClient();
    const actor = await resolveActor(request, admin);
    if (actor instanceof NextResponse) return actor;
    const input = inputs.parse(await request.json());

    const { data: project } = await admin.from("projects").select("id, name, project_number").eq("id", input.project_id).maybeSingle();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    let result: unknown;
    switch (input.action) {
      case "list":
        result = { project, ...(await listSelections(admin, project.id, { includeRemoved: input.include_removed })) };
        break;
      case "allowance":
        result = { project, ...(await allowanceCheck(admin, project.id)) };
        break;
      case "add":
        result = { item: await addSelectionItem(admin, project.id, input.item, actor, { source: input.source, note: input.note }) };
        break;
      case "update":
        result = await updateSelectionItem(admin, input.item_id, input.changes, actor, { source: input.source, note: input.note, projectId: project.id });
        break;
      case "draft_sheet":
        result = await draftSheetRevision(admin, project.id, actor, { title: input.title, intro: input.intro });
        break;
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: error.issues }, { status: 400 });
    if (error instanceof SelectionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[api/selections]", error);
    return NextResponse.json({ error: "Selections update failed. Check the log before retrying." }, { status: 500 });
  }
}
