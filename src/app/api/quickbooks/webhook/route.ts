import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncChangedEntities, type ChangedEntity } from "@/lib/quickbooks/sync";

// QuickBooks webhook receiver. Intuit POSTs entity-change notifications here
// (configured in the Intuit developer portal under Webhooks). Each request is
// signed with HMAC-SHA256 using the app's Verifier Token
// (app_settings.quickbooks_webhook_verifier).

interface WebhookPayload {
  eventNotifications?: Array<{
    realmId: string;
    dataChangeEvent?: {
      entities?: Array<{ name: string; id: string; operation: string }>;
    };
  }>;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("intuit-signature");

  const supabase = createAdminClient();
  const { data: settings } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["quickbooks_webhook_verifier", "quickbooks_realm_id"]);
  const get = (k: string) => settings?.find((s) => s.key === k)?.value || "";

  const verifier = get("quickbooks_webhook_verifier");
  if (verifier) {
    if (!signature) {
      return NextResponse.json({ error: "missing signature" }, { status: 401 });
    }
    const expected = createHmac("sha256", verifier).update(rawBody).digest("base64");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
  } else {
    console.warn("QB webhook: no verifier token configured — signature not checked");
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const connectedRealm = get("quickbooks_realm_id");
  const entities: ChangedEntity[] = [];
  for (const notification of payload.eventNotifications ?? []) {
    // Ignore events for companies other than the one we're connected to.
    if (connectedRealm && notification.realmId !== connectedRealm) continue;
    for (const entity of notification.dataChangeEvent?.entities ?? []) {
      if (entity.operation === "Delete" || entity.operation === "Remove") continue;
      entities.push({ name: entity.name, id: entity.id });
    }
  }

  if (entities.length > 0) {
    try {
      const result = await syncChangedEntities(entities);
      console.log("QB webhook sync:", JSON.stringify({ received: entities.length, ...result }));
    } catch (e) {
      // Still return 200 — Intuit retries on failure and we don't want a
      // transient error to disable the webhook subscription.
      console.error("QB webhook sync failed:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
