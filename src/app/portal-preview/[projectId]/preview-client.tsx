"use client";

import { useCallback, useEffect, useState } from "react";
import { ClientPortalView } from "@/components/portal/client-portal-view";
import type { PortalData } from "@/lib/portal/types";

export function PortalPreviewClient({ projectId }: { projectId: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/portal/preview?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("Couldn't load the preview."));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="flex min-h-screen items-center justify-center bg-[#F7F5F1] p-8 text-center text-[15px] text-[#9E4E28]">{error}</div>;
  if (!data) return <div className="flex min-h-screen items-center justify-center bg-[#F7F5F1] text-[15px] font-semibold text-[#606B65]">Loading preview…</div>;
  return <ClientPortalView data={data} onReload={load} />;
}
