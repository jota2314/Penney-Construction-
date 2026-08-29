"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatAddressParts, navigationHref, type AddressParts } from "@/lib/maps";

type AddressLinkProps = AddressParts & {
  /** Pre-joined address, when the caller already built the string. */
  value?: string | null;
  /** Custom content (icon + text). Defaults to the formatted address. */
  children?: ReactNode;
  className?: string;
  /** For the feed surfaces that theme with inline styles rather than classes. */
  style?: CSSProperties;
};

/**
 * A tappable address that opens turn-by-turn directions.
 *
 * Rendered as a <button>, not an <a>, on purpose: most addresses in this app
 * sit inside a card that is itself a <Link>, and a nested anchor breaks the
 * HTML parser during hydration. The handler stops propagation so tapping the
 * address navigates to Maps instead of opening the card behind it.
 *
 * Renders nothing when there is no address, so callers can drop it in place of
 * their existing `{address && ...}` guard.
 */
export function AddressLink({
  value,
  address,
  city,
  state,
  zip,
  latitude,
  longitude,
  children,
  className,
  style,
}: AddressLinkProps) {
  const parts: AddressParts = value
    ? { address: value, latitude, longitude }
    : { address, city, state, zip, latitude, longitude };
  const text = formatAddressParts(parts);
  const href = navigationHref(parts);
  if (!text || !href) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
      }}
      style={style}
      title={`Directions to ${text}`}
      aria-label={`Get directions to ${text}`}
      className={cn(
        "min-w-0 cursor-pointer text-left underline-offset-2 transition-opacity hover:underline active:opacity-60",
        className
      )}
    >
      {children ?? text}
    </button>
  );
}
