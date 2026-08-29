/**
 * One place that turns an address into turn-by-turn navigation.
 *
 * Every address the app shows should be tappable and drop the user straight
 * into directions from wherever they are — Jorge and the crew are usually in a
 * truck when they need it. We use the Google Maps universal directions link:
 * on a phone it hands off to the installed Maps app (Google Maps on Android,
 * and on iOS it opens the Google Maps app when installed, the mobile web map
 * otherwise), and on desktop it opens the web map. Same URL everywhere, no
 * platform sniffing.
 */

export type AddressParts = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  /** When the job site has been geocoded, coordinates beat the typed address. */
  latitude?: number | string | null;
  longitude?: number | string | null;
};

/** Join whatever address pieces exist into one display line, or null if none. */
export function formatAddressParts(parts: AddressParts): string | null {
  const line = [parts.address, parts.city, parts.state]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(", ");
  const zip = typeof parts.zip === "string" ? parts.zip.trim() : "";
  const full = [line, zip].filter(Boolean).join(" ").trim();
  return full || null;
}

function coordDestination(parts: AddressParts): string | null {
  const lat = Number(parts.latitude);
  const lng = Number(parts.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return `${lat},${lng}`;
}

/**
 * Directions URL for an address (or a plain address string). Returns null when
 * there is nothing to navigate to, so callers can render plain text instead.
 */
export function navigationHref(parts: AddressParts | string | null | undefined): string | null {
  if (!parts) return null;
  const destination =
    typeof parts === "string" ? parts.trim() : coordDestination(parts) ?? formatAddressParts(parts);
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    destination
  )}&travelmode=driving`;
}

/** Open directions in a new tab. Safe to call from any click handler. */
export function openNavigation(parts: AddressParts | string | null | undefined): void {
  const href = navigationHref(parts);
  if (!href || typeof window === "undefined") return;
  window.open(href, "_blank", "noopener,noreferrer");
}
