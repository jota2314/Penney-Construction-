"use client";

import { useState, useEffect } from "react";
import { MapPin, Navigation } from "lucide-react";
import { navigationHref } from "@/lib/maps";

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
  const [workerLat, setWorkerLat] = useState<number | null>(null);
  const [workerLng, setWorkerLng] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "loading" | "found" | "denied" | "unavailable"
  >("loading");

  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

  // Watch worker's location
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setWorkerLat(pos.coords.latitude);
        setWorkerLng(pos.coords.longitude);
        setLocationStatus("found");
      },
      () => setLocationStatus("denied"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Calculate distance
  useEffect(() => {
    if (workerLat == null || workerLng == null) return;
    if (latitude == null || longitude == null) return;
    setDistance(getDistanceFeet(workerLat, workerLng, latitude, longitude));
  }, [workerLat, workerLng, latitude, longitude]);

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

  const isOnSite = distance !== null && distance < 500;
  const isFar = distance !== null && distance >= 500;

  // Build Google Maps Static API URL with both markers
  let mapUrl = "";
  if (apiKey && latitude && longitude) {
    const markers = [
      `markers=color:orange|${latitude},${longitude}`,
    ];
    if (workerLat != null && workerLng != null) {
      markers.push(`markers=color:blue|${workerLat},${workerLng}`);
    }
    const center = `${latitude},${longitude}`;
    mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=17&size=800x400&scale=2&maptype=roadmap&style=feature:all|element:geometry|color:0x242f3e&style=feature:all|element:labels.text.stroke|color:0x242f3e&style=feature:all|element:labels.text.fill|color:0x746855&style=feature:road|element:geometry|color:0x38414e&style=feature:water|element:geometry|color:0x17263c&${markers.join("&")}&key=${apiKey}`;
  }

  // Tapping the map starts driving directions, not a dropped pin. Coordinates
  // win when the site has been geocoded — the typed address can be a lot fuzzier.
  const mapsLink =
    navigationHref({ address: fullAddress, latitude, longitude }) ?? "#";

  return (
    <div className="space-y-2">
      {/* Map */}
      <a
        href={mapsLink}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-xl overflow-hidden h-48 md:h-56 border border-border/50 relative"
      >
        {mapUrl ? (
          <img
            src={mapUrl}
            alt={fullAddress || "Job site"}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-muted/30 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <MapPin className="h-6 w-6 mx-auto mb-1 text-amber-500" />
              <p className="text-sm font-medium text-foreground">{fullAddress}</p>
              <p className="text-xs mt-1">Tap for directions</p>
            </div>
          </div>
        )}
        {/* Legend */}
        {mapUrl && workerLat != null && (
          <div className="absolute bottom-2 left-2 flex gap-2">
            <div className="flex items-center gap-1 bg-black/70 rounded-full px-2 py-0.5">
              <div className="h-2.5 w-2.5 rounded-full bg-orange-500" />
              <span className="text-[10px] text-white">Job</span>
            </div>
            <div className="flex items-center gap-1 bg-black/70 rounded-full px-2 py-0.5">
              <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
              <span className="text-[10px] text-white">You</span>
            </div>
          </div>
        )}
      </a>

      {/* Location status */}
      <div className="flex items-center gap-2 px-1">
        <Navigation className="h-3.5 w-3.5 shrink-0" />
        {locationStatus === "loading" && (
          <p className="text-xs text-muted-foreground">Getting your location...</p>
        )}
        {locationStatus === "denied" && (
          <p className="text-xs text-red-400">
            Location access denied — enable GPS to verify you&apos;re on site
          </p>
        )}
        {locationStatus === "unavailable" && (
          <p className="text-xs text-muted-foreground">
            Location not available on this device
          </p>
        )}
        {locationStatus === "found" && distance === null && (
          <p className="text-xs text-muted-foreground">
            Location found — no project coordinates to compare
          </p>
        )}
        {locationStatus === "found" && isOnSite && (
          <p className="text-xs text-emerald-400 font-medium">
            You&apos;re on site ({Math.round(distance!)} ft from job)
          </p>
        )}
        {locationStatus === "found" && isFar && (
          <p className="text-xs text-red-400 font-medium">
            You&apos;re {formatDistance(distance!)} from the job site
          </p>
        )}
      </div>
    </div>
  );
}

function getDistanceFeet(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const R = 20902231;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(feet: number): string {
  if (feet < 5280) return `${Math.round(feet)} ft away`;
  return `${(feet / 5280).toFixed(1)} miles away`;
}
