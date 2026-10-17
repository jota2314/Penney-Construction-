"use client";

import dynamic from "next/dynamic";
import { PortalHeader, PortalTheme } from "@/components/portal-kit";

// Client-only: the app reads the portal cookie via fetch, its job and tab
// from the address bar, and queued photos from the phone's storage, so
// there is nothing useful to render on the server and no hydration
// mismatch to worry about. The placeholder is the same light shell, so
// the screen doesn't flash while the app loads.
const SubPortalApp = dynamic(
  () => import("@/components/sub-portal/portal-app").then((m) => m.SubPortalApp),
  {
    ssr: false,
    loading: () => (
      <PortalTheme variant="field">
        <PortalHeader subtitle="Penney Construction · Sub portal" title="Loading…" />
        <div aria-busy="true" className="mx-auto max-w-2xl space-y-4 px-4 py-6">
          <div className="h-[44px] w-2/3 rounded-full bg-[var(--line)]" />
          <div className="h-32 rounded-2xl bg-[var(--line)]" />
          <div className="h-[60px] rounded-2xl bg-[var(--line)]" />
        </div>
      </PortalTheme>
    ),
  },
);

/** /sub/portal — the signed-in subcontractor's app. */
export default function SubPortalPage() {
  return <SubPortalApp />;
}
