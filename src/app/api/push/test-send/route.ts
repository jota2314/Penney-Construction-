import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:jbetancur@penneyconstructioninc.com";

  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: "vapid_not_configured" }, { status: 500 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", auth.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!subs || subs.length === 0) {
    return NextResponse.json({ error: "no_subscriptions" }, { status: 404 });
  }

  const payload = JSON.stringify({
    title: "Penney Construction",
    body: "Test notification from your iPhone PWA — it works.",
    url: "/command-center",
    tag: "test-push",
  });

  const results = await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        return { id: sub.id, ok: true };
      } catch (err: unknown) {
        const e = err as { statusCode?: number; body?: string };
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
        return { id: sub.id, ok: false, error: e.body || String(err) };
      }
    })
  );

  return NextResponse.json({ sent: results.filter((r) => r.ok).length, results });
}
