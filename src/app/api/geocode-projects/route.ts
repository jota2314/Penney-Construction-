import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/google/geocode";

/**
 * POST /api/geocode-projects
 * Geocodes all projects that have addresses but no lat/lng.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Get projects with address but no coordinates
  const { data: projects } = await supabase
    .from("projects")
    .select("id, address, city, state, zip")
    .not("address", "is", null)
    .is("latitude", null);

  if (!projects || projects.length === 0) {
    return NextResponse.json({ message: "All projects already geocoded", updated: 0 });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const project of projects) {
    const coords = await geocodeAddress(
      project.address!,
      project.city,
      project.state,
      project.zip
    );

    if (coords.ok) {
      const { error } = await supabase
        .from("projects")
        .update({ latitude: coords.lat, longitude: coords.lng })
        .eq("id", project.id);

      if (!error) updated++;
      else errors.push(`${project.id}: ${error.message}`);
    } else {
      errors.push(`${project.id}: "${project.address}" — ${coords.reason}`);
    }

    // Rate limit: 50ms between requests
    await new Promise((r) => setTimeout(r, 50));
  }

  return NextResponse.json({
    total: projects.length,
    updated,
    errors: errors.length > 0 ? errors : undefined,
  });
}
