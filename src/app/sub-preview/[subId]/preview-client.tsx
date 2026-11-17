"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PortalTheme } from "@/components/portal-kit";
import { SubPortalView } from "@/components/sub-portal/sub-portal-view";
import type { SubHomePayload } from "@/lib/sub-portal/payload";

/**
 * The staff preview: the sub's own portal view fed by the read-only
 * preview-data route. data.mode is "preview", so SubPortalView shows the
 * maroon banner, disables every action and sends job fetches to the
 * preview-data job URL. Nothing here sets a cookie or saves anything.
 */
export function SubPreviewClient({ subId }: { subId: string }) {
  const [data, setData] = useState<SubHomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(() => {
    const sequence = ++request.current;
    return fetch(`/api/sub-portal/preview-data?subId=${encodeURIComponent(subId)}`, { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (sequence !== request.current) return;
      if (!res.ok) {
        if ([401, 403, 404].includes(res.status)) setData(null);
        setError(body?.error || "Couldn’t load the preview. Try again.");
        return;
      }
      if (body?.mode !== "preview" || body?.sub?.sub_id !== subId) {
        setData(null);
        setError("Couldn’t verify this company’s preview. Try again.");
        return;
      }
      setError(null);
      setData(body);
    }).catch(() => {
      if (sequence === request.current) setError("Couldn’t load the preview. Check your connection and try again.");
    });
  }, [subId]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  if (!data) {
    return (
      <PortalTheme variant="field">
        <div className="flex min-h-screen items-center justify-center p-8 text-center text-[16px] font-semibold">
          {error ? (
            <div>
              <p role="alert" style={{ color: "var(--accent-dark)" }}>{error}</p>
              <button type="button" className="btn btn-ghost mt-3" onClick={() => void load()}>Try again</button>
            </div>
          ) : (
            <p style={{ color: "var(--muted)" }}>Loading preview…</p>
          )}
        </div>
      </PortalTheme>
    );
  }
  return <SubPortalView data={data} onReload={load} refreshError={error} />;
}
