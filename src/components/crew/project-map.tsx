"use client";

import { MapPin } from "lucide-react";

interface ProjectMapProps {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
}

export function ProjectMap({
  address,
  city,
  state,
  zip,
  latitude,
  longitude,
}: ProjectMapProps) {
  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

  if (!fullAddress && !latitude) {
    return (
      <div className="rounded-xl bg-muted/30 border border-border/50 h-48 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <MapPin className="h-6 w-6 mx-auto mb-1 opacity-40" />
          <p className="text-xs">No address on file</p>
        </div>
      </div>
    );
  }

  // Use coordinates if available, otherwise geocode by address
  const query =
    latitude && longitude
      ? `${latitude},${longitude}`
      : encodeURIComponent(fullAddress);

  // Google Maps Embed API — much more reliable than JS API loader
  if (apiKey) {
    return (
      <div className="rounded-xl overflow-hidden h-48 md:h-64 border border-border/50">
        <iframe
          width="100%"
          height="100%"
          style={{ border: 0 }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          src={`https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${query}&zoom=16&maptype=roadmap`}
          title="Job site location"
          allow="fullscreen"
        />
      </div>
    );
  }

  // No API key fallback — link to Google Maps
  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl bg-muted/30 border border-border/50 h-48 flex items-center justify-center hover:border-amber-500/30 transition-colors"
    >
      <div className="text-center text-muted-foreground">
        <MapPin className="h-6 w-6 mx-auto mb-1 text-amber-500" />
        <p className="text-sm font-medium text-foreground">{fullAddress}</p>
        <p className="text-xs mt-1">Tap to open in Google Maps</p>
      </div>
    </a>
  );
}
