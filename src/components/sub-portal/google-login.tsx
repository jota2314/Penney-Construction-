"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type GoogleIdentity = {
  initialize: (options: {
    client_id: string; nonce: string; auto_select: boolean;
    callback: (response: { credential: string }) => void;
  }) => void;
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
};

function destination() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && (next === "/sub/portal" || next.startsWith("/sub/portal?")) ? next : "/sub/portal";
}

/** Google's identity-only popup; no Gmail, Drive or staff account access. */
export function SubGoogleLogin({ onSignedIn }: { onSignedIn?: () => void } = {}) {
  const button = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = useRef(onSignedIn);
  useEffect(() => { signedIn.current = onSignedIn; }, [onSignedIn]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const controller = new AbortController();

    async function initialize() {
      try {
        const response = await fetch("/api/sub-portal/google", { cache: "no-store", signal: controller.signal });
        const config = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error(config.error || "Google sign-in is unavailable.");
        const google = (window as typeof window & { google?: { accounts?: { id?: GoogleIdentity } } }).google?.accounts?.id;
        if (!google || !button.current) throw new Error("Google sign-in did not load. Reload the page or use your phone and PIN.");
        google.initialize({
          client_id: config.clientId, nonce: config.nonce, auto_select: false,
          callback: async ({ credential }) => {
            if (!active) return;
            setBusy(true);
            setError(null);
            try {
              const result = await fetch("/api/sub-portal/google", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credential }),
              });
              const data = await result.json();
              if (!result.ok) throw new Error(data.error || "Sign-in failed. Try again.");
              if (signedIn.current) signedIn.current();
              else window.location.assign(destination());
            } catch (err) {
              if (active) {
                setError(err instanceof Error ? err.message : "Check your connection and try again.");
                setBusy(false);
              }
            }
          },
        });
        button.current.replaceChildren();
        google.renderButton(button.current, {
          type: "standard", theme: "outline", size: "large", text: "continue_with",
          width: Math.min(400, button.current.clientWidth || 280),
        });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Google sign-in is unavailable.");
      }
    }
    void initialize();
    return () => { active = false; controller.abort(); };
  }, [ready, attempt]);

  return (
    <div className="card mt-5 space-y-3 p-4">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive"
        onReady={() => setReady(true)}
        onError={() => setError("Google sign-in did not load. Reload this page or use your phone and PIN.")} />
      <p className="text-[16px] font-bold">Sign in with Google</p>
      <p className="text-[15px] text-[var(--muted)]">Choose the Google account Penney invited.</p>
      <div ref={button} className={busy ? "pointer-events-none opacity-50" : "min-h-[44px]"} aria-busy={busy} />
      {!ready && !error && <p role="status" className="text-sm">Loading Google sign-in…</p>}
      {busy && <p role="status" className="text-sm">Signing in…</p>}
      {error && (
        <div role="alert" className="space-y-2 text-[15px] text-red-700">
          <p>{error}</p>
          {ready && <button type="button" className="font-bold underline" onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try Google again</button>}
        </div>
      )}
    </div>
  );
}
