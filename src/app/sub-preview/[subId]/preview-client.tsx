"use client";

import { useCallback, useEffect, useState } from "react";
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

  const load = useCallback(() => {
    fetch(`/api/sub-portal/preview-data?subId=${encodeURIComponent(subId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: SubHomePayload | { error?: string }) => {
        if ("error" in d && d.error) {
          setError(d.error);
        } else {
          setError(null);
          setData(d as SubHomePayload);
        }
      })
      .catch(() => setError("Couldn't load the preview. Check your connection and refresh."));
  }, [subId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <PortalTheme variant="field">
        <div className="flex min-h-screen items-center justify-center p-8 text-center text-[16px] font-semibold">
          {error ? (
            <p style={{ color: "var(--accent-dark)" }}>{error}</p>
          ) : (
            <p style={{ color: "var(--muted)" }}>Loading preview…</p>
          )}
        </div>
      </PortalTheme>
    );
  }
  return <SubPortalView data={data} onReload={load} />;
}
