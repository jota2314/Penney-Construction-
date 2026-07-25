/**
 * Server-side geocoding using Google Geocoding API.
 * Converts address strings to lat/lng coordinates.
 */

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export type GeocodeResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; reason: string };

/**
 * Turns a Google Geocoding response into a human-readable failure reason.
 * Google puts the useful part in `error_message` (billing disabled, API not
 * enabled, key restricted) — never swallow it, that's what makes a broken
 * geocode look like a broken address.
 */
function describeFailure(data: {
  status?: string;
  error_message?: string;
}): string {
  const status = data.status ?? "UNKNOWN";
  if (data.error_message) return `${status}: ${data.error_message}`;
  if (status === "ZERO_RESULTS") return "ZERO_RESULTS: Google found no match for that address";
  return status;
}

export async function geocodeAddress(
  address: string,
  city: string | null,
  state: string | null,
  zip: string | null
): Promise<GeocodeResult> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "Missing NEXT_PUBLIC_GOOGLE_PLACES_API_KEY" };
  }

  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");
  if (!fullAddress) return { ok: false, reason: "No address to geocode" };

  try {
    const res = await fetch(
      `${GEOCODE_URL}?address=${encodeURIComponent(fullAddress)}&key=${apiKey}`
    );
    if (!res.ok) {
      return { ok: false, reason: `Google Geocoding API returned HTTP ${res.status}` };
    }

    const data = await res.json();
    if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
      return { ok: false, reason: describeFailure(data) };
    }

    const { lat, lng } = data.results[0].geometry.location;
    return { ok: true, lat, lng };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Geocode request failed",
    };
  }
}
