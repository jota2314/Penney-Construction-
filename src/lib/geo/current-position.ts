export type Coords = { lat: number; lng: number; accuracy: number };

/**
 * Read the device's current location once. Resolves to null instead of throwing
 * when location is unavailable or denied, so callers (clock-in) can proceed
 * without a fix rather than blocking the worker on a GPS hiccup.
 */
export async function getCurrentPosition(timeoutMs = 8000): Promise<Coords | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return null;
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: timeoutMs },
    );
  });
}
