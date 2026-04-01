"use client";

import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { MapPin } from "lucide-react";

interface ProjectMapProps {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
}

let optionsSet = false;

export function ProjectMap({
  address,
  city,
  state,
  zip,
  latitude,
  longitude,
}: ProjectMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey || !mapRef.current) return;

    if (!optionsSet) {
      setOptions({
        key: apiKey,
        v: "weekly",
        libraries: ["places", "geocoding", "maps", "marker"],
      });
      optionsSet = true;
    }

    let cancelled = false;

    async function initMap() {
      try {
        const mapsLib = await importLibrary("maps") as typeof google.maps;
        if (cancelled || !mapRef.current) return;

        let lat = latitude ? Number(latitude) : null;
        let lng = longitude ? Number(longitude) : null;

        // Geocode if no coordinates stored
        if ((lat === null || lng === null) && fullAddress) {
          await importLibrary("geocoding");
          const geocoder = new google.maps.Geocoder();
          try {
            const result = await geocoder.geocode({ address: fullAddress });
            if (result.results[0]?.geometry?.location) {
              lat = result.results[0].geometry.location.lat();
              lng = result.results[0].geometry.location.lng();
            }
          } catch {
            setError(true);
            return;
          }
        }

        if (lat === null || lng === null) {
          setError(true);
          return;
        }

        const position = { lat, lng };

        const map = new mapsLib.Map(mapRef.current!, {
          center: position,
          zoom: 16,
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          styles: [
            {
              elementType: "geometry",
              stylers: [{ color: "#1a1a2e" }],
            },
            {
              elementType: "labels.text.stroke",
              stylers: [{ color: "#1a1a2e" }],
            },
            {
              elementType: "labels.text.fill",
              stylers: [{ color: "#8a8a9a" }],
            },
            {
              featureType: "road",
              elementType: "geometry",
              stylers: [{ color: "#2a2a3e" }],
            },
            {
              featureType: "road",
              elementType: "geometry.stroke",
              stylers: [{ color: "#1a1a2e" }],
            },
            {
              featureType: "water",
              elementType: "geometry",
              stylers: [{ color: "#0e0e1a" }],
            },
            {
              featureType: "poi",
              elementType: "geometry",
              stylers: [{ color: "#222238" }],
            },
          ],
        });

        new google.maps.Marker({
          position,
          map,
          title: fullAddress || "Job Site",
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#D97706",
            fillOpacity: 1,
            strokeColor: "#FFFFFF",
            strokeWeight: 2,
          },
        });
      } catch {
        setError(true);
      }
    }

    initMap();
    return () => { cancelled = true; };
  }, [latitude, longitude, fullAddress]);

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

  if (error) {
    // Fallback: show address as link to Google Maps
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

  return (
    <div
      ref={mapRef}
      className="rounded-xl overflow-hidden h-48 md:h-64 border border-border/50"
    />
  );
}
