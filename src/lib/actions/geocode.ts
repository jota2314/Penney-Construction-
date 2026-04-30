"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const GEOCODE_API = "https://maps.googleapis.com/maps/api/geocode/json";

type GeocodeHit = { lat: number; lng: number };

async function geocodeOne(query: string, apiKey: string): Promise<GeocodeHit | null> {
  const url = `${GEOCODE_API}?address=${encodeURIComponent(query)}&key=${apiKey}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) return null;
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

/**
 * Geocode every project that has an address but no lat/lng. Writes coordinates
 * back so the Map view can pin them. Safe to re-run — only touches missing rows.
 * Uses the existing NEXT_PUBLIC_GOOGLE_PLACES_API_KEY (Geocoding API must be
 * enabled on the same Google Cloud project).
 */
export async function backfillProjectCoordinates(): Promise<{
  ok: boolean;
  updated: number;
  skipped: number;
  failed: number;
  message?: string;
}> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { ok: false, updated: 0, skipped: 0, failed: 0, message: "Missing NEXT_PUBLIC_GOOGLE_PLACES_API_KEY" };
  }

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

  for (const p of projects) {
    const parts = [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ");
    if (!parts) {
      skipped++;
      continue;
    }
    const hit = await geocodeOne(parts, apiKey);
    if (!hit) {
      failed++;
      continue;
    }
    const { error } = await supabase
      .from("projects")
      .update({ latitude: hit.lat, longitude: hit.lng })
      .eq("id", p.id);
    if (error) failed++;
    else updated++;
  }

  revalidatePath("/command-center");
  return { ok: true, updated, skipped, failed };
}
