"use client";

import { useState, useEffect } from "react";
import { MapPin, Navigation } from "lucide-react";

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

  // Get worker's current location
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setWorkerLat(pos.coords.latitude);
        setWorkerLng(pos.coords.longitude);
        setLocationStatus("found");
      },
      () => {
        setLocationStatus("denied");
      },
      { timeout: 10000 }
    );
  }, []);

  // Calculate distance between worker and job site
  useEffect(() => {
    if (workerLat == null || workerLng == null) return;
    if (latitude == null || longitude == null) return;

    const dist = getDistanceFeet(workerLat, workerLng, latitude, longitude);
    setDistance(dist);
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

  // Build map URL — OpenStreetMap (no API key needed, always works)
  const mapLat = latitude || 42.5;
  const mapLng = longitude || -70.9;
  const hasCoords = latitude != null && longitude != null;

  const isOnSite = distance !== null && distance < 500; // within 500 feet
  const isFar = distance !== null && distance >= 500;

  return (
    <div className="space-y-2">
      {/* Map */}
      <div className="rounded-xl overflow-hidden h-48 md:h-56 border border-border/50 relative">
        {hasCoords ? (
          <iframe
            width="100%"
            height="100%"
            style={{ border: 0 }}
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${mapLng - 0.005},${mapLat - 0.003},${mapLng + 0.005},${mapLat + 0.003}&layer=mapnik&marker=${mapLat},${mapLng}`}
            title="Job site location"
          />
        ) : (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="h-full flex items-center justify-center bg-muted/30 hover:border-amber-500/30"
          >
            <div className="text-center text-muted-foreground">
              <MapPin className="h-6 w-6 mx-auto mb-1 text-amber-500" />
              <p className="text-sm font-medium text-foreground">
                {fullAddress}
              </p>
              <p className="text-xs mt-1">Tap to open in Google Maps</p>
            </div>
          </a>
        )}
      </div>

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

/**
 * Calculate distance between two coordinates in feet.
 * Uses Haversine formula.
 */
function getDistanceFeet(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 20902231; // Earth radius in feet
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(feet: number): string {
  if (feet < 5280) return `${Math.round(feet)} ft away`;
  return `${(feet / 5280).toFixed(1)} miles away`;
}
