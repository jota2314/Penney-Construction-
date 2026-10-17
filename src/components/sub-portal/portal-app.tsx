"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PortalHeader, PortalTheme } from "@/components/portal-kit";
import { telHref } from "@/lib/portal-kit/format";
import type { SubHomePayload } from "@/lib/sub-portal/payload";
import { resumeSubOutbox, setSubOutboxOwner } from "./post-outbox";
import { SubPortalView } from "./sub-portal-view";

const OFFICE_PHONE = "978-621-4387";
// Coming back to the app refetches only when the screen is older than this.
const STALE_MS = 2 * 60_000;

/**
 * /sub/portal: the signed-in sub's app, as a thin shell around
 * SubPortalView. It loads the light home payload (GET /api/sub-portal, his
 * cookie), restarts the post outbox so photos left on the phone finish
 * uploading (its saved posts go once the GET says who is signed in:
 * setSubOutboxOwner), and refetches when he comes back to the app after more
 * than two minutes. Each job loads on its own when he opens it (job-screen.tsx).
 *
 * Signed out (401) goes to /sub, carrying a QR's ?job=…&compose=1 along so
 * he lands on that job after the PIN. Turned off (403) shows the server's
 * reason instead of the login.
 */
export function SubPortalApp() {
  const router = useRouter();
  const [data, setData] = useState<SubHomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedAt = useRef(0);
  const inFlight = useRef(false);
  // A reload asked for while one is running (a tap during a background
  // refresh) runs again afterwards, so the screen never shows the older read.
  const again = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        let res: Response;
        try {
          res = await fetch("/api/sub-portal", { cache: "no-store", credentials: "same-origin" });
        } catch {
          setError("No connection. Check your signal and try again.");
          return;
        }
        if (res.status === 401) {
          // Nobody signed in: hold what's on the phone for whoever signs in next.
          setSubOutboxOwner(null);
          const here = `${window.location.pathname}${window.location.search}`;
          router.replace(here.startsWith("/sub/portal?") ? `/sub?next=${encodeURIComponent(here)}` : "/sub");
          return;
        }
        if (res.status === 403) {
          // Turned off by the office (or a staff browser): a PIN won't help, so say why.
          // Drop the screen he had: a turned-off sub must see why, not the old payload.
          const refused = (await res.json().catch(() => null)) as { error?: string } | null;
          setSubOutboxOwner(null);
          setData(null);
          setError(refused?.error || "Portal access has been turned off. Contact Penney Construction.");
          return;
        }
        const body = (await res.json().catch(() => null)) as (SubHomePayload & { error?: string }) | null;
        if (!res.ok || !body || body.error) {
          setError(body?.error || "We couldn't load your portal. Try again.");
          return;
        }
        loadedAt.current = Date.now();
        // The outbox sends (and counts) only this company's saved posts, so a
        // phone shared with another company never posts theirs under this login.
        setSubOutboxOwner(body.sub.sub_id);
        setError(null);
        setData(body);
      } while (again.current);
    } finally {
      inFlight.current = false;
    }
  }, [router]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    resumeSubOutbox();
    void load();
  }, [load]);

  // Back to the app: finish any queued uploads, and refresh if it's been a
  // while (the office may have booked, confirmed or paid something).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      resumeSubOutbox();
      if (Date.now() - loadedAt.current > STALE_MS) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  if (data) return <SubPortalView data={data} onReload={reload} />;

  return (
    <PortalTheme variant="field">
      <PortalHeader subtitle="Penney Construction · Sub portal" title={error ? "Sub portal" : "Loading…"} />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        {error ? (
          <section className="card p-5 text-center">
            <p className="text-[17px] font-bold">{error}</p>
            <button type="button" onClick={reload} className="btn btn-primary btn-lg btn-block mt-4">
              Try again
            </button>
            <a href={telHref(OFFICE_PHONE)} className="btn btn-ghost btn-block mt-3">
              Call the office · {OFFICE_PHONE}
            </a>
          </section>
        ) : (
          <PortalSkeleton />
        )}
      </main>
    </PortalTheme>
  );
}

/** Grey blocks where Today will be. Still, no shimmer. */
function PortalSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your portal" className="space-y-4">
      <div className="h-[44px] w-2/3 rounded-full bg-[var(--line)]" />
      <div className="h-32 rounded-2xl bg-[var(--line)]" />
      <div className="h-[60px] rounded-2xl bg-[var(--line)]" />
      <div className="h-[60px] rounded-2xl bg-[var(--line)]" />
    </div>
  );
}
