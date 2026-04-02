"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Navigation, Loader2 } from "lucide-react";

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
  const mapRef = useRef<HTMLDivElement>(null);
  const [workerLat, setWorkerLat] = useState<number | null>(null);
  const [workerLng, setWorkerLng] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "loading" | "found" | "denied" | "unavailable"
  >("loading");
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const workerMarkerRef = useRef<google.maps.Marker | null>(null);

  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

  // Get worker's current location + watch for updates
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
      () => {
        setLocationStatus("denied");
      },
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

  // Update worker marker on map when position changes
  useEffect(() => {
    if (!mapInstanceRef.current || workerLat == null || workerLng == null) return;

    const pos = { lat: workerLat, lng: workerLng };

    if (workerMarkerRef.current) {
      workerMarkerRef.current.setPosition(pos);
    } else {
      workerMarkerRef.current = new google.maps.Marker({
        position: pos,
        map: mapInstanceRef.current,
        title: "Your location",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#4285F4",
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 3,
        },
        zIndex: 10,
      });

      // Also add a pulse circle around the worker dot
      new google.maps.Marker({
        position: pos,
        map: mapInstanceRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 20,
          fillColor: "#4285F4",
          fillOpacity: 0.15,
          strokeColor: "#4285F4",
          strokeWeight: 1,
          strokeOpacity: 0.3,
        },
        zIndex: 5,
      });
    }
  }, [workerLat, workerLng]);

  // Load Google Maps
  const initMap = useCallback(async () => {
    if (!apiKey || !mapRef.current || mapLoaded) return;

    try {
      // Load the Google Maps script if not already loaded
      if (!window.google?.maps) {
        await new Promise<void>((resolve, reject) => {
          // Check if script already exists
          if (document.querySelector(`script[src*="maps.googleapis.com"]`)) {
            const check = setInterval(() => {
              if (window.google?.maps) {
                clearInterval(check);
                resolve();
              }
            }, 100);
            setTimeout(() => { clearInterval(check); reject(); }, 10000);
            return;
          }

          const script = document.createElement("script");
          script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject();
          document.head.appendChild(script);
        });
      }

      let lat = latitude ? Number(latitude) : null;
      let lng = longitude ? Number(longitude) : null;

      // Geocode if no coordinates
      if ((lat == null || lng == null) && fullAddress) {
        const geocoder = new google.maps.Geocoder();
        const result = await geocoder.geocode({ address: fullAddress });
        if (result.results[0]?.geometry?.location) {
          lat = result.results[0].geometry.location.lat();
          lng = result.results[0].geometry.location.lng();
        }
      }

      if (lat == null || lng == null) {
        setMapError(true);
        return;
      }

      const position = { lat, lng };

      const map = new google.maps.Map(mapRef.current, {
        center: position,
        zoom: 17,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: [
          { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
          { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
          { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
          { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
          { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
          { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
          { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
          { featureType: "poi", elementType: "geometry", stylers: [{ color: "#283d6a" }] },
          { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6f9ba5" }] },
        ],
      });

      mapInstanceRef.current = map;

      // Project location marker (orange)
      new google.maps.Marker({
        position,
        map,
        title: fullAddress || "Job Site",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: "#D97706",
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 3,
        },
      });

      setMapLoaded(true);
    } catch {
      setMapError(true);
    }
  }, [apiKey, latitude, longitude, fullAddress, mapLoaded]);

  useEffect(() => {
    initMap();
  }, [initMap]);

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

  return (
    <div className="space-y-2">
      {/* Map */}
      {mapError ? (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl bg-muted/30 border border-border/50 h-56 flex items-center justify-center hover:border-amber-500/30 transition-colors"
        >
          <div className="text-center text-muted-foreground">
            <MapPin className="h-6 w-6 mx-auto mb-1 text-amber-500" />
            <p className="text-sm font-medium text-foreground">{fullAddress}</p>
            <p className="text-xs mt-1">Tap to open in Google Maps</p>
          </div>
        </a>
      ) : (
        <div className="relative">
          <div
            ref={mapRef}
            className="rounded-xl overflow-hidden h-56 md:h-64 border border-border/50"
          />
          {!mapLoaded && (
            <div className="absolute inset-0 rounded-xl bg-muted/50 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
            </div>
          )}
        </div>
      )}

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
