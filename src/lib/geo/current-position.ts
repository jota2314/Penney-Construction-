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
    // Browser timeouts may exclude permission-prompt time, and some webviews
    // never call either callback. Clock-in must still reach the server.
    let settled = false;
    const finish = (coords: Coords | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(coords);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      navigator.geolocation.getCurrentPosition(
      (p) =>
        finish({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () => finish(null),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: timeoutMs },
      );
    } catch {
      finish(null);
    }
  });
}
