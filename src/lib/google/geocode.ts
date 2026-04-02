/**
 * Server-side geocoding using Google Geocoding API.
 * Converts address strings to lat/lng coordinates.
 */

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export async function geocodeAddress(
  address: string,
  city: string | null,
  state: string | null,
  zip: string | null
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");
  if (!fullAddress) return null;

  try {
    const res = await fetch(
      `${GEOCODE_URL}?address=${encodeURIComponent(fullAddress)}&key=${apiKey}`
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
      return null;
    }

    const { lat, lng } = data.results[0].geometry.location;
    return { lat, lng };
  } catch {
    return null;
  }
}
