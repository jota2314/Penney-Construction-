"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ClientPortalView } from "@/components/portal/client-portal-view";
import type { PortalData } from "@/lib/portal/types";

// The homeowner's portal. The link (token) is the key: no password. All data
// comes from /api/portal, which validates the token server-side and returns
// only published, client-safe content.
export default function ClientPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/portal?token=${token}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("We couldn't load your project."));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (error) return <Shell><p className="max-w-sm px-8 text-center text-[15px] text-[#9E4E28]">{error}</p></Shell>;
  if (!data) return <Shell><p className="text-[15px] font-semibold text-[#606B65]">Loading your project…</p></Shell>;
  return <ClientPortalView data={data} token={token} onReload={load} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-[#F7F5F1]">{children}</div>;
}
