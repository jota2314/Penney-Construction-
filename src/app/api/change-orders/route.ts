import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import {
  ChangeOrderError,
  createChangeOrderDraft,
  listChangeOrders,
  previewChangeOrderSend,
  sendChangeOrderToClient,
  updateChangeOrderDraft,
  type ChangeOrderActor,
} from "@/lib/change-orders/service";

export const runtime = "nodejs";
// Sending renders the PDF and talks to Gmail before it answers.
export const maxDuration = 60;

/**
 * POST /api/change-orders — client change orders for the Penney MCP.
 *
 * Two ways in, one code path (the same handshake as /api/selections):
 *  - a signed-in office user (field crew refused), or
 *  - the Penney MCP: x-service-key + x-penney-actor (the verified caller's
 *    profile id).
 * The actor is always resolved here: a caller can't name someone else, and a
 * change order sent from chat leaves from that person's own Gmail.
 *
 * Actions: list, create (draft only), update (unsigned only), preview_send
 * (the exact client email, nothing sent) and send (requires authorized=true).
 */
const uuid = z.string().uuid();
const dollars = z
  .number()
  .finite()
  .min(-10_000_000)
  .max(10_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001, "Use dollars with at most two decimal places");
const title = z.string().trim().min(3).max(200);
const description = z.string().trim().max(4000);
const trade = z.string().trim().max(60);
const notes = z.string().trim().max(2000);

const inputs = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), project_id: uuid }).strict(),
  z
    .object({
      action: z.literal("create"),
      project_id: uuid,
      title,
      description: description.optional(),
      trade: trade.optional(),
      cost_impact: dollars,
      price_impact: dollars,
      notes: notes.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      change_order_id: uuid,
      title: title.optional(),
      description: description.optional(),
      trade: trade.optional(),
      cost_impact: dollars.optional(),
      price_impact: dollars.optional(),
      notes: notes.optional(),
    })
    .strict(),
  z.object({ action: z.literal("preview_send"), change_order_id: uuid }).strict(),
  z.object({ action: z.literal("send"), change_order_id: uuid, authorized: z.literal(true) }).strict(),
]);

async function resolveActor(
  request: NextRequest,
  admin: ReturnType<typeof createAdminClient>,
): Promise<ChangeOrderActor | NextResponse> {
  const supplied = request.headers.get("x-service-key");
  if (supplied !== null) {
    const { data, error } = await admin.from("app_settings").select("value").eq("key", "proposal_pdf_service_key").single();
    const expected = Buffer.from(String(data?.value ?? ""));
    const actual = Buffer.from(supplied);
    if (error || !expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const actorId = uuid.safeParse(request.headers.get("x-penney-actor"));
    if (!actorId.success) return NextResponse.json({ error: "Verified caller required" }, { status: 401 });
    const { data: profile } = await admin
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("id", actorId.data)
      .maybeSingle();
    if (!profile || profile.role === "field") {
      return NextResponse.json({ error: "Change orders are for the office and project managers." }, { status: 403 });
    }
    return { profileId: profile.id, name: profile.full_name || profile.email, email: profile.email };
  }
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (user.isImpersonating) return NextResponse.json({ error: "Exit View-as first." }, { status: 403 });
  if (!user.profile || user.profile.role === "field") {
    return NextResponse.json({ error: "Change orders are for the office and project managers." }, { status: 403 });
  }
  return { profileId: user.profile.id, name: user.profile.full_name || user.email, email: user.profile.email };
}

/** The public site address, for the PDF fetch and the client's signing link. */
function originOf(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(forwardedHost)) return `https://${forwardedHost}`;
  if (forwardedHost) return `http://${forwardedHost}`;
  const host = request.headers.get("host");
  if (host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`;
  return "https://www.penneyconstruction.build";
}

export async function POST(request: NextRequest) {
  try {
    const admin = createAdminClient();
    const actor = await resolveActor(request, admin);
    if (actor instanceof NextResponse) return actor;
    const input = inputs.parse(await request.json());
    const origin = originOf(request);

    let result: unknown;
    switch (input.action) {
      case "list":
        result = await listChangeOrders(admin, input.project_id, origin);
        break;
      case "create": {
        const { action: _action, ...fields } = input;
        result = await createChangeOrderDraft(admin, actor, fields, origin);
        break;
      }
      case "update": {
        const { action: _action, ...fields } = input;
        if (Object.keys(fields).length < 2) throw new ChangeOrderError("Nothing to change.");
        result = await updateChangeOrderDraft(admin, fields, origin);
        break;
      }
      case "preview_send":
        result = await previewChangeOrderSend(admin, actor, input.change_order_id, origin);
        break;
      case "send":
        result = await sendChangeOrderToClient(admin, actor, input.change_order_id, origin);
        break;
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") },
        { status: 400 },
      );
    }
    if (err instanceof ChangeOrderError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[change-orders]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Change order request failed." }, { status: 500 });
  }
}
