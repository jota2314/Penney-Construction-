/**
 * Geofence radius around a job site, in meters (~500 ft). A clock-in or ping
 * within this distance of the project's pin counts as "on site". Generous
 * enough to absorb normal phone GPS error (often 10-50 m, worse near buildings)
 * without false "off-site" flags. Dependency-free so client and server share it.
 */
export const GEOFENCE_METERS = 150;

/** Great-circle distance between two lat/lng points, in meters (haversine). */
export function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Human-friendly distance ("120 ft" / "0.4 mi"). */
export function formatDistance(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.round(feet)} ft`;
  return `${(feet / 5280).toFixed(1)} mi`;
}
