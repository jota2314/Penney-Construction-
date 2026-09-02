"use client";

import dynamic from "next/dynamic";
import { Shell, Skeleton } from "@/components/sub-portal/ui";

// Client-only: the app reads the portal cookie via fetch and restores the
// last tab from localStorage, so there is nothing useful to render on the
// server and no hydration mismatch to worry about.
const SubPortalApp = dynamic(
  () => import("@/components/sub-portal/portal-app").then((m) => m.SubPortalApp),
  {
    ssr: false,
    loading: () => (
      <Shell>
        <div className="mx-auto max-w-2xl space-y-3 px-5 pt-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-6 h-20" />
          <div className="grid grid-cols-2 gap-2.5">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-40" />
        </div>
      </Shell>
    ),
  },
);

/** /sub/portal — the signed-in subcontractor's app. */
export default function SubPortalPage() {
  return <SubPortalApp />;
}
