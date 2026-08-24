import type { Metadata } from "next";
import { MapPinned } from "lucide-react";
import { requireAuth } from "@/lib/auth/require-auth";
import { getLiveMapData } from "@/lib/actions/live-map";
import { MapView } from "@/components/field-feed/map-view";

export const metadata: Metadata = { title: "Route | Penney Construction" };

/**
 * The runner's map. Every active jobsite as a pin, with MapView's route
 * planner on top so a run can be ordered before leaving the shop.
 *
 * Deliberately not the office /command-center/map: that one carries the
 * spend-by-the-second banner and the live crew roster. This is the same pins,
 * none of the money.
 */
export default async function CrewMapPage() {
  await requireAuth();
  const { pins, missingCoordsCount } = await getLiveMapData();

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Today&apos;s run</h1>
          <p className="text-xs text-muted-foreground">
            {pins.length} active {pins.length === 1 ? "site" : "sites"}. Pick your stops, then
            build the route.
          </p>
        </div>
      </div>

      {pins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MapPinned className="mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No active jobsites to map right now.</p>
        </div>
      ) : (
        <MapView pins={pins} missingProjectCount={missingCoordsCount} height="clamp(320px, 58vh, 620px)" />
      )}
    </div>
  );
}
