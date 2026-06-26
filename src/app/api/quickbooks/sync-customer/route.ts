import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken } from "@/lib/quickbooks/auth";
import { findOrCreateQBCustomer, type CustomerForQB } from "@/lib/quickbooks/client";

export const runtime = "nodejs";

/**
 * Create (or reuse) a QuickBooks customer for an app customer, and save the
 * resulting QB id back onto the customers row.
 *
 * Two auth paths:
 *  - a signed-in user (the "Sync to QuickBooks" button in the app), or
 *  - a service key in the x-service-key header (so the Penney MCP / cron can
 *    trigger it headlessly). The key lives in app_settings('quickbooks_service_key').
 *
 * Body: { customer_id: string }
 */
export async function POST(request: NextRequest) {
  let body: { customer_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const customerId = body.customer_id;
  if (!customerId) {
    return NextResponse.json({ error: "customer_id required" }, { status: 400 });
  }

  // Resolve auth → choose the Supabase client used for the rest of the request.
  let supabase;
  const serviceKey = request.headers.get("x-service-key");
  if (serviceKey) {
    const admin = createAdminClient();
    const { data: keyRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "quickbooks_service_key")
      .maybeSingle();
    const expected = String(keyRow?.value ?? "");
    const a = Buffer.from(serviceKey);
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "Invalid service key" }, { status: 401 });
    }
    supabase = admin;
  } else {
    supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Load the app customer.
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email, phone, address, city, state, zip, quickbooks_id")
    .eq("id", customerId)
    .single();

  if (custErr || !customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  // Already linked — nothing to do.
  if (customer.quickbooks_id) {
    return NextResponse.json({
      ok: true,
      already: true,
      qbId: customer.quickbooks_id,
      message: "Customer is already linked to QuickBooks.",
    });
  }

  try {
    const { accessToken, realmId, environment, baseUrl } = await getValidAccessToken(supabase);

    const result = await findOrCreateQBCustomer(
      realmId,
      accessToken,
      customer as CustomerForQB,
      baseUrl
    );

    const { error: updateErr } = await supabase
      .from("customers")
      .update({ quickbooks_id: result.qbId, qb_synced_at: new Date().toISOString() })
      .eq("id", customerId);

    if (updateErr) {
      return NextResponse.json(
        { error: `Created QB customer ${result.qbId} but failed to save link: ${updateErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      already: false,
      environment,
      qbId: result.qbId,
      created: result.created,
      matchedBy: result.matchedBy,
      message: result.created
        ? `Created QuickBooks customer "${result.displayName}" (${environment}).`
        : `Linked to existing QuickBooks customer "${result.displayName}" (matched by ${result.matchedBy}).`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
