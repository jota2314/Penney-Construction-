import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getLiveMapData } from "@/lib/actions/live-map";
import { LiveMap } from "@/components/command-center/live-map";

export const metadata: Metadata = { title: "Live Map | Penney Construction" };

export default async function LiveMapPage() {
  const user = await requireAuth();
  // Same hideFinances rule as the command-center feed: field crew and PMs
  // don't see company spend numbers.
  const profileRole = user.profile?.role ?? "precon_manager";
  const showSpend = profileRole !== "field" && profileRole !== "project_manager";

  const data = await getLiveMapData();

  return (
    <>
      <Header title="Live Map" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 min-w-0 overflow-auto">
        <LiveMap
          pins={data.pins}
          activeShifts={data.activeShifts}
          completedTodayCents={data.completedTodayCents}
          missingCoordsCount={data.missingCoordsCount}
          showSpend={showSpend}
        />
      </div>
    </>
  );
}
