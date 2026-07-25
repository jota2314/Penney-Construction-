"use server";

import { createClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/google/geocode";
import { revalidatePath } from "next/cache";

/**
 * Statuses that mean the Google Cloud project itself is misconfigured (billing
 * off, Geocoding API not enabled, key restricted). Retrying the other rows is
 * pointless — every one will fail the same way — so we stop and report.
 */
const FATAL_STATUSES = ["REQUEST_DENIED", "OVER_QUERY_LIMIT", "Missing NEXT_PUBLIC"];

function isFatal(reason: string): boolean {
  return FATAL_STATUSES.some((s) => reason.startsWith(s));
}

/**
 * Geocode every project that has an address but no lat/lng. Writes coordinates
 * back so the Map view can pin them. Safe to re-run — only touches missing rows.
 * Uses the existing NEXT_PUBLIC_GOOGLE_PLACES_API_KEY (Geocoding API must be
 * enabled, and billing active, on the same Google Cloud project).
 */
export async function backfillProjectCoordinates(): Promise<{
  ok: boolean;
  updated: number;
  skipped: number;
  failed: number;
  message?: string;
}> {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, address, city, state, zip")
    .is("latitude", null)
    .not("address", "is", null);

  if (!projects || projects.length === 0) {
    return { ok: true, updated: 0, skipped: 0, failed: 0, message: "Nothing to geocode" };
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let firstFailure: string | undefined;

  for (const p of projects) {
    if (!p.address) {
      skipped++;
      continue;
    }

    const hit = await geocodeAddress(p.address, p.city, p.state, p.zip);
    if (!hit.ok) {
      failed++;
      firstFailure ??= hit.reason;
      // A config-level rejection will hit every remaining row. Bail out now so
      // the user sees the real cause instead of 40-odd identical failures.
      if (isFatal(hit.reason)) {
        return {
          ok: false,
          updated,
          skipped,
          failed: projects.length - updated - skipped,
          message: hit.reason,
        };
      }
      continue;
    }

    const { error } = await supabase
      .from("projects")
      .update({ latitude: hit.lat, longitude: hit.lng })
      .eq("id", p.id);
    if (error) {
      failed++;
      firstFailure ??= error.message;
    } else {
      updated++;
    }
  }

  revalidatePath("/command-center");
  return {
    ok: failed === 0,
    updated,
    skipped,
    failed,
    message: firstFailure ? `${failed} failed — first: ${firstFailure}` : undefined,
  };
}
