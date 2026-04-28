"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function TestPushPage() {
  const [status, setStatus] = useState<string>("");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.pushManager.getSubscription().then((sub) => setSubscribed(!!sub));
    });
  }, []);

  async function enable() {
    setBusy(true);
    setStatus("");
    try {
      if (!("serviceWorker" in navigator)) throw new Error("Service workers not supported on this device");

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setStatus(`Permission: ${perm}. Open iOS Settings → Notifications → Penney Construction to allow.`);
        return;
      }

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("VAPID public key missing in environment");

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error(`Subscribe failed: ${res.status}`);

      setSubscribed(true);
      setStatus("Subscribed. Tap 'Send Test Push' next.");
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/push/test-send", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStatus(`Sent to ${data.sent} device(s). Lock your phone — it should buzz in a second.`);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Push Notification Test</h1>
        <p className="text-sm text-muted-foreground mt-1">
          For iOS: this page must be opened from the home-screen icon, not Safari.
        </p>
      </div>

      <div className="space-y-2 text-sm">
        <div>
          Browser permission: <span className="font-mono">{permission}</span>
        </div>
        <div>
          Subscribed: <span className="font-mono">{subscribed ? "yes" : "no"}</span>
        </div>
      </div>

      <div className="space-y-3">
        <Button
          onClick={enable}
          disabled={busy || permission === "unsupported"}
          className="w-full h-12"
        >
          {subscribed ? "Re-subscribe" : "Enable Notifications"}
        </Button>
        <Button
          onClick={sendTest}
          disabled={busy || !subscribed}
          variant="secondary"
          className="w-full h-12"
        >
          Send Test Push
        </Button>
      </div>

      {status && (
        <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap">{status}</div>
      )}

      {permission === "unsupported" && (
        <div className="rounded-lg border border-destructive/50 p-3 text-sm">
          This browser doesn&apos;t support web push. On iPhone, install to home
          screen and open from the home-screen icon (iOS 16.4+).
        </div>
      )}
    </div>
  );
}
