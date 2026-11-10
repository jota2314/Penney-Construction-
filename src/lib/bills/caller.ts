import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";

/**
 * Who is filing a bill through /api/bills/{scan,allocate,commit}.
 *
 * Two ways in, one code path (the same handshake as /api/change-orders and
 * /api/bills/pay-approval):
 *  - a signed-in person in the app (the Expenses sheet's bill drop), or
 *  - the Penney MCP: x-service-key + x-penney-actor, the verified caller's
 *    profile id. Field accounts are refused on that path; bills from chat are
 *    for the office.
 *
 * The routes then read, split and file exactly as they do for the bill drop:
 * same AI read, same budget split, same duplicate/quote/credit checks, same
 * approver gate and QuickBooks push. Only the database client differs: the
 * MCP path has no browser session, so it uses the service client.
 */
export type BillCaller = {
  profileId: string;
  /** The real account's email, for the pay-approval allowlist (never View-as). */
  email: string | null;
  db: SupabaseClient;
  viaService: boolean;
};

export type BillCallerResult =
  | { ok: true; caller: BillCaller }
  | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveBillCaller(request: NextRequest): Promise<BillCallerResult> {
  const supplied = request.headers.get("x-service-key");
  if (supplied !== null) {
    const admin = createAdminClient();
    const { data, error } = await admin.from("app_settings").select("value").eq("key", "proposal_pdf_service_key").single();
    const expected = Buffer.from(String(data?.value ?? ""));
    const actual = Buffer.from(supplied);
    if (error || !expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }
    const actorId = request.headers.get("x-penney-actor") ?? "";
    if (!UUID.test(actorId)) return { ok: false, status: 401, error: "Verified caller required" };
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, role")
      .eq("id", actorId)
      .maybeSingle();
    if (!profile) return { ok: false, status: 401, error: "Verified caller required" };
    if (profile.role === "field") {
      return { ok: false, status: 403, error: "Filing bills from chat is for the office. Use the crew receipt scanner." };
    }
    return { ok: true, caller: { profileId: profile.id, email: profile.email ?? null, db: admin, viaService: true } };
  }

  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id;
  if (!profileId) return { ok: false, status: 401, error: "Not authenticated" };
  return {
    ok: true,
    caller: {
      profileId,
      email: user?.realProfile?.email ?? user?.email ?? null,
      db: (await createClient()) as unknown as SupabaseClient,
      viaService: false,
    },
  };
}
