"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { v } from "./tokens";
import { backfillProjectCoordinates } from "@/lib/actions/geocode";

/**
 * Interactive jobsite map: amber pins per project, live "me" tracking, and
 * tap-to-select smart-route building via Google Directions. Extracted from the
 * schedule strip so both the week schedule and the command-center Map popup
 * can share it — callers supply pins from whatever project set they have.
 */
export type MapPin = {
  project_id: string;
  project_name: string;
  project_number: string;
  lat: number;
  lng: number;
  /** Street address shown in the route stop list. */
  address: string | null;
  /** Names of workers currently on the clock at this site (live map). */
  liveCrew?: string[];
};

type RouteResult = {
  orderedStops: MapPin[];
  origin: { lat: number; lng: number };
  distanceMeters: number;
  durationSec: number;
  mapsUrl: string;
};

function fmtMiles(meters: number): string {
  const mi = meters / 1609.344;
  return mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

type RouteEndpoint =
  | { kind: "myLocation" }
  | { kind: "address"; address: string; lat?: number; lng?: number }
  | { kind: "lastStop" };

export function MapView({
  pins,
  missingProjectCount = 0,
  height = 380,
}: {
  pins: MapPin[];
  missingProjectCount?: number;
  /** Map canvas height in px. */
  height?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, { marker: any; pin: any }>>(new Map());
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meMarkerRef = useRef<any>(null);
  const watchIdRef = useRef<number | null>(null);
  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [tracking, setTracking] = useState(false);
  const [trackErr, setTrackErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingGeocode, startGeocode] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [building, setBuilding] = useState(false);

  // Start/end of the route — defaults to "my location" both ways.
  const [originSetting, setOriginSetting] = useState<RouteEndpoint>({ kind: "myLocation" });
  const [destSetting, setDestSetting] = useState<RouteEndpoint>({ kind: "lastStop" });
  const [originAddress, setOriginAddress] = useState("");
  const [destAddress, setDestAddress] = useState("");

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

  useEffect(() => {
    if (!ref.current || !apiKey) return;
    let cancelled = false;

    (async () => {
      try {
        const { setOptions, importLibrary } = await import("@googlemaps/js-api-loader");
        setOptions({ key: apiKey, v: "weekly" });
        const [mapsLib, markerLib] = await Promise.all([
          importLibrary("maps") as Promise<google.maps.MapsLibrary>,
          importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
        ]);
        const { Map: MapsMap } = mapsLib;
        const { AdvancedMarkerElement, PinElement } = markerLib;
        if (cancelled || !ref.current) return;

        const center = pins.length
          ? { lat: pins[0].lat, lng: pins[0].lng }
          : { lat: 42.5048, lng: -70.8967 };

        const mapInstance = new MapsMap(ref.current, {
          center,
          zoom: pins.length > 1 ? 9 : 12,
          mapId: "PENNEY_SCHEDULE_DARK",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        mapRef.current = mapInstance;

        if (pins.length > 1) {
          const bounds = new google.maps.LatLngBounds();
          pins.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
          mapInstance.fitBounds(bounds, 60);
        }

        markersRef.current.clear();

        for (const pin of pins) {
          const pinGlyph = new PinElement({
            background: "#D97706",
            borderColor: "#1a0f00",
            glyphColor: "#1a0f00",
            scale: 1.0,
          });

          const liveCount = pin.liveCrew?.length ?? 0;
          const labelEl = document.createElement("div");
          labelEl.textContent = liveCount > 0
            ? `${pin.project_name} · ${liveCount} on site`
            : pin.project_name;
          labelEl.style.cssText = [
            "position:absolute",
            "left:100%",
            "top:50%",
            "transform:translateY(-50%)",
            "margin-left:6px",
            "padding:3px 7px",
            "background:rgba(22,20,15,0.92)",
            liveCount > 0
              ? "border:1px solid rgba(16,185,129,0.65)"
              : "border:1px solid rgba(217,119,6,0.5)",
            "border-radius:5px",
            "color:#F5F1EA",
            "font-family:var(--font-geist-sans),-apple-system,sans-serif",
            "font-size:11px",
            "font-weight:600",
            "white-space:nowrap",
            "max-width:200px",
            "overflow:hidden",
            "text-overflow:ellipsis",
            "box-shadow:0 2px 6px rgba(0,0,0,0.4)",
            "pointer-events:none",
          ].join(";");

          pinGlyph.element.style.position = "relative";
          pinGlyph.element.appendChild(labelEl);

          const m = new AdvancedMarkerElement({
            position: { lat: pin.lat, lng: pin.lng },
            map: mapInstance,
            title: `${pin.project_name} — tap to add to route`,
            content: pinGlyph.element,
          });
          m.addListener("click", () => {
            setSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(pin.project_id)) next.delete(pin.project_id);
              else next.add(pin.project_id);
              return next;
            });
            // Tapping a pin invalidates the previously-built route
            setRouteResult(null);
            if (rendererRef.current) {
              rendererRef.current.setMap(null);
              rendererRef.current = null;
            }
          });
          markersRef.current.set(pin.project_id, { marker: m, pin: pinGlyph });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load Google Maps");
      }
    })();

    const markers = markersRef.current;
    return () => {
      cancelled = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      markers.forEach(({ marker }: { marker: any }) => { marker.map = null; });
      markers.clear();
      if (rendererRef.current) {
        rendererRef.current.setMap(null);
        rendererRef.current = null;
      }
      mapRef.current = null;
    };
  }, [apiKey, pins]);

  // Recolor pins as selection changes (selected = green, unselected = amber)
  useEffect(() => {
    markersRef.current.forEach(({ pin }, projectId) => {
      const isSelected = selectedIds.has(projectId);
      pin.background = isSelected ? "#10b981" : "#D97706";
      pin.borderColor = isSelected ? "#06291f" : "#1a0f00";
      pin.glyphColor = isSelected ? "#06291f" : "#1a0f00";
    });
  }, [selectedIds]);

  // Track me live: watchPosition + render a blue dot that follows me as I move.
  useEffect(() => {
    if (!tracking) return;
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setTrackErr("Live location requires HTTPS.");
      setTracking(false);
      return;
    }
    if (!navigator.geolocation) {
      setTrackErr("This browser doesn't support geolocation.");
      setTracking(false);
      return;
    }

    setTrackErr(null);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setMyPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        const code = err?.code;
        if (code === 1) setTrackErr("Location permission denied. Allow it in site settings.");
        else if (code === 2) setTrackErr("Couldn't determine your location.");
        else if (code === 3) setTrackErr("Location request timed out.");
        else setTrackErr(err?.message || "Location error.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    watchIdRef.current = id;

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [tracking]);

  // Render / move the blue-dot marker as my position changes.
  useEffect(() => {
    let cancelled = false;
    if (!mapRef.current || !myPosition || !apiKey) return;

    (async () => {
      const { setOptions, importLibrary } = await import("@googlemaps/js-api-loader");
      setOptions({ key: apiKey, v: "weekly" });
      const markerLib = (await importLibrary("marker")) as google.maps.MarkerLibrary;
      const { AdvancedMarkerElement } = markerLib;
      if (cancelled || !mapRef.current) return;

      if (!meMarkerRef.current) {
        const dot = document.createElement("div");
        dot.style.cssText = [
          "width:16px",
          "height:16px",
          "border-radius:50%",
          "background:#3b82f6",
          "border:3px solid #ffffff",
          "box-shadow:0 0 0 4px rgba(59,130,246,0.25),0 1px 4px rgba(0,0,0,0.4)",
          "position:relative",
        ].join(";");
        meMarkerRef.current = new AdvancedMarkerElement({
          position: myPosition,
          map: mapRef.current,
          title: "You are here",
          content: dot,
          zIndex: 1000,
        });
      } else {
        meMarkerRef.current.position = myPosition;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [myPosition, apiKey]);

  // Clean up the blue dot when tracking stops.
  useEffect(() => {
    if (tracking) return;
    if (meMarkerRef.current) {
      meMarkerRef.current.map = null;
      meMarkerRef.current = null;
    }
    setMyPosition(null);
  }, [tracking]);

  const recenterOnMe = () => {
    if (!mapRef.current || !myPosition) return;
    mapRef.current.panTo(myPosition);
    mapRef.current.setZoom(Math.max(mapRef.current.getZoom() ?? 12, 14));
  };

  const runBackfill = () => {
    startGeocode(async () => {
      const res = await backfillProjectCoordinates();
      if (!res.ok) setError(res.message ?? "Geocode failed");
      else window.location.reload();
    });
  };

  const getMyLocation = async (): Promise<{ lat: number; lng: number }> => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      throw new Error("Location requires HTTPS. Open the site over https.");
    }
    if (!navigator.geolocation) {
      throw new Error("This browser doesn't support geolocation.");
    }
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 12000,
        enableHighAccuracy: true,
        maximumAge: 30000,
      });
    }).catch((e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (e as any)?.code;
      if (code === 1) throw new Error("Location permission denied. Open site settings → set Location to Allow.");
      if (code === 2) throw new Error("Couldn't determine your location. Check OS location services.");
      if (code === 3) throw new Error("Location request timed out. Try again.");
      throw e instanceof Error ? e : new Error("Couldn't get your location.");
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  };

  const geocodeAddress = async (addr: string): Promise<{ lat: number; lng: number }> => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
    const data = await res.json();
    if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
      throw new Error(`Could not find that address: "${addr}"`);
    }
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  };

  const resolveEndpoint = async (
    setting: RouteEndpoint,
    typed: string,
    label: string,
  ): Promise<{ lat: number; lng: number } | null> => {
    if (setting.kind === "myLocation") return getMyLocation();
    if (setting.kind === "lastStop") return null; // resolved post-optimization
    // address kind
    const addr = typed.trim();
    if (!addr) throw new Error(`Enter a ${label} address.`);
    return geocodeAddress(addr);
  };

  const buildRoute = async () => {
    if (!mapRef.current || selectedIds.size === 0) return;
    setError(null);
    setBuilding(true);

    const stops = pins.filter((p) => selectedIds.has(p.project_id));

    let origin: { lat: number; lng: number };
    try {
      const o = await resolveEndpoint(originSetting, originAddress, "start");
      if (!o) throw new Error("Origin resolution failed.");
      origin = o;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBuilding(false);
      return;
    }

    let explicitDestination: { lat: number; lng: number } | null = null;
    try {
      explicitDestination = await resolveEndpoint(destSetting, destAddress, "end");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBuilding(false);
      return;
    }

    const waypoints = stops;

    try {
      const { setOptions, importLibrary } = await import("@googlemaps/js-api-loader");
      setOptions({ key: apiKey!, v: "weekly" });
      const routesLib = (await importLibrary("routes")) as google.maps.RoutesLibrary;
      const { DirectionsService, DirectionsRenderer } = routesLib;
      const directions = new DirectionsService();

      // If user picked a specific destination address, the optimizer needs to
      // see it as the destination (not a waypoint). If they left it as
      // "lastStop", the optimizer picks which stop is last.
      const destForOptimizer = explicitDestination ?? origin; // origin used as a placeholder for round-trip when "lastStop" mode

      const result = await directions.route({
        origin,
        destination: destForOptimizer,
        waypoints: waypoints.map((s) => ({ location: { lat: s.lat, lng: s.lng }, stopover: true })),
        optimizeWaypoints: true,
        travelMode: google.maps.TravelMode.DRIVING,
      });

      if (rendererRef.current) rendererRef.current.setMap(null);
      const renderer = new DirectionsRenderer({
        map: mapRef.current,
        suppressMarkers: true,
        polylineOptions: { strokeColor: "#10b981", strokeWeight: 5, strokeOpacity: 0.9 },
      });
      renderer.setDirections(result);
      rendererRef.current = renderer;

      const route = result.routes[0];
      const order = route.waypoint_order ?? [];
      const orderedStops = order.length ? order.map((i) => waypoints[i]) : waypoints;

      const distance = route.legs.reduce((s, l) => s + (l.distance?.value ?? 0), 0);
      const duration = route.legs.reduce((s, l) => s + (l.duration?.value ?? 0), 0);

      // Deep link: if user gave an explicit destination, use it. Otherwise
      // last stop. All stops in optimized order go in waypoints.
      let destForLink: { lat: number; lng: number };
      let waypointsForLink: typeof orderedStops;
      if (explicitDestination) {
        destForLink = explicitDestination;
        waypointsForLink = orderedStops;
      } else {
        destForLink = orderedStops[orderedStops.length - 1];
        waypointsForLink = orderedStops.slice(0, -1);
      }
      const wpParam = waypointsForLink.map((s) => `${s.lat},${s.lng}`).join("|");
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destForLink.lat},${destForLink.lng}${wpParam ? `&waypoints=${encodeURIComponent(wpParam)}` : ""}&travelmode=driving`;

      setRouteResult({
        orderedStops,
        origin,
        distanceMeters: distance,
        durationSec: duration,
        mapsUrl,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build route");
    } finally {
      setBuilding(false);
    }
  };

  const clearRoute = () => {
    setSelectedIds(new Set());
    setRouteResult(null);
    if (rendererRef.current) {
      rendererRef.current.setMap(null);
      rendererRef.current = null;
    }
  };

  if (!apiKey) {
    return (
      <div
        className="rounded-lg p-6 text-center text-[13px]"
        style={{ background: v("bg-2"), border: `1px dashed ${v("line")}`, color: v("muted") }}
      >
        Set <code>NEXT_PUBLIC_GOOGLE_PLACES_API_KEY</code> in env to enable the Map view.
      </div>
    );
  }

  const selectedPins = pins.filter((p) => selectedIds.has(p.project_id));

  return (
    <div className="flex flex-col gap-2">
      {missingProjectCount > 0 && (
        <div
          className="rounded-lg px-3 py-2 flex items-center justify-between gap-3 text-[12px]"
          style={{ background: "rgba(217, 119, 6, 0.08)", border: "1px solid rgba(217, 119, 6, 0.25)", color: "#fbbf24" }}
        >
          <span>
            <span className="font-semibold">{missingProjectCount}</span> {missingProjectCount === 1 ? "jobsite is" : "jobsites are"} missing coordinates and won&apos;t show on the map.
          </span>
          <button
            onClick={runBackfill}
            disabled={pendingGeocode}
            className="px-2.5 py-1 rounded text-[11px] font-semibold transition active:scale-95 disabled:opacity-50"
            style={{ background: v("accent"), color: "#1a0f00" }}
          >
            {pendingGeocode ? "Geocoding…" : "Geocode now"}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => setTracking((t) => !t)}
          className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-[12px] font-semibold transition active:scale-[0.98]"
          style={{
            background: tracking ? "rgba(59, 130, 246, 0.18)" : v("bg-2"),
            color: tracking ? "#60a5fa" : v("ink"),
            border: `1px solid ${tracking ? "rgba(59, 130, 246, 0.45)" : v("line")}`,
          }}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{
              background: tracking ? "#3b82f6" : v("muted"),
              boxShadow: tracking ? "0 0 8px #3b82f6" : "none",
            }}
          />
          {tracking ? (myPosition ? "Tracking · live" : "Locating…") : "Show me on map"}
        </button>
        {tracking && myPosition && (
          <button
            onClick={recenterOnMe}
            className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-[12px] font-semibold transition active:scale-[0.98]"
            style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-3.5 h-3.5">
              <circle cx="10" cy="10" r="3" />
              <path d="M10 1v3M10 16v3M1 10h3M16 10h3" />
            </svg>
            Center on me
          </button>
        )}
        {trackErr && (
          <span className="text-[11px]" style={{ color: "#fca5a5" }}>{trackErr}</span>
        )}
      </div>

      <div
        ref={ref}
        className="rounded-lg overflow-hidden"
        style={{ height, background: v("bg-2"), border: `1px solid ${v("line")}` }}
      />

      <div
        className="rounded-lg px-3 py-2 text-[12px]"
        style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("muted") }}
      >
        Tap pins to add stops. Build Route picks the smartest order.
      </div>

      {/* Selection panel — appears when pins are selected */}
      {selectedPins.length > 0 && !routeResult && (
        <div
          className="rounded-xl p-3 flex flex-col gap-3"
          style={{ background: v("card"), border: `1px solid rgba(16, 185, 129, 0.30)` }}
        >
          <div className="flex items-center justify-between">
            <div className="text-[12px]" style={{ color: v("ink") }}>
              <span className="font-semibold">{selectedPins.length}</span> {selectedPins.length === 1 ? "stop" : "stops"} selected
            </div>
            <button onClick={clearRoute} className="text-[11px]" style={{ color: v("muted") }}>
              Clear
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {selectedPins.map((p) => (
              <span
                key={p.project_id}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium"
                style={{ background: "rgba(16, 185, 129, 0.14)", border: "1px solid rgba(16, 185, 129, 0.40)", color: "#34d399" }}
              >
                {p.project_name}
              </span>
            ))}
          </div>

          {/* Start picker */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
              Start from
            </span>
            <div className="flex gap-1">
              {(["myLocation", "address"] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() => setOriginSetting({ kind } as RouteEndpoint)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition"
                  style={{
                    background: originSetting.kind === kind ? v("accent") : v("bg-2"),
                    color: originSetting.kind === kind ? "#1a0f00" : v("muted"),
                    border: `1px solid ${originSetting.kind === kind ? "transparent" : v("line")}`,
                  }}
                >
                  {kind === "myLocation" ? "📍 My location" : "Address"}
                </button>
              ))}
            </div>
            {originSetting.kind === "address" && (
              <input
                type="text"
                value={originAddress}
                onChange={(e) => setOriginAddress(e.target.value)}
                placeholder="e.g. 14 Cameron Rd, Lynn MA"
                className="w-full rounded-md px-3 py-2 text-[13px] outline-none"
                style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
              />
            )}
          </div>

          {/* End picker */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
              End at
            </span>
            <div className="flex flex-wrap gap-1">
              {(["lastStop", "myLocation", "address"] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() => setDestSetting({ kind } as RouteEndpoint)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition"
                  style={{
                    background: destSetting.kind === kind ? v("accent") : v("bg-2"),
                    color: destSetting.kind === kind ? "#1a0f00" : v("muted"),
                    border: `1px solid ${destSetting.kind === kind ? "transparent" : v("line")}`,
                  }}
                >
                  {kind === "lastStop" ? "Last stop" : kind === "myLocation" ? "📍 Back to start" : "Address"}
                </button>
              ))}
            </div>
            {destSetting.kind === "address" && (
              <input
                type="text"
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                placeholder="e.g. Penney HQ, 100 Main St"
                className="w-full rounded-md px-3 py-2 text-[13px] outline-none"
                style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
              />
            )}
          </div>

          <button
            onClick={buildRoute}
            disabled={building}
            className="w-full py-2.5 rounded-lg text-[14px] font-semibold transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: v("accent"), color: "#1a0f00" }}
          >
            {building ? "Building route…" : `Build smart route (${selectedPins.length} ${selectedPins.length === 1 ? "stop" : "stops"})`}
          </button>
        </div>
      )}

      {/* Route result — appears after Build Route succeeds */}
      {routeResult && (
        <div
          className="rounded-xl p-3 flex flex-col gap-3"
          style={{ background: v("card"), border: `1px solid rgba(16, 185, 129, 0.30)` }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div
                className="text-[10px] font-semibold uppercase"
                style={{ color: "#34d399", letterSpacing: "0.18em" }}
              >
                Smart route
              </div>
              <div className="text-[14px] font-semibold mt-0.5" style={{ color: v("ink") }}>
                {fmtMiles(routeResult.distanceMeters)} · {fmtDuration(routeResult.durationSec)}
              </div>
            </div>
            <button onClick={clearRoute} className="text-[11px]" style={{ color: v("muted") }}>
              Clear
            </button>
          </div>
          <ol className="flex flex-col gap-1.5">
            {routeResult.orderedStops.map((s, i) => {
              const stopNavUrl = `https://www.google.com/maps/dir/?api=1&origin=${routeResult.origin.lat},${routeResult.origin.lng}&destination=${s.lat},${s.lng}&travelmode=driving`;
              return (
                <li
                  key={s.project_id}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg"
                  style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                >
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                    style={{ background: "#10b981", color: "#06291f" }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate" style={{ color: v("ink") }}>
                      {s.project_name}
                    </div>
                    {s.address && (
                      <div className="text-[11px] truncate" style={{ color: v("muted") }}>
                        {s.address}
                      </div>
                    )}
                  </div>
                  <a
                    href={stopNavUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Navigate to ${s.project_name}`}
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition active:scale-95"
                    style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("accent") }}
                  >
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <path d="M3 17l14-14M3 17h7M3 17V10" />
                    </svg>
                  </a>
                </li>
              );
            })}
          </ol>
          <a
            href={routeResult.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2.5 rounded-lg flex items-center justify-center gap-2 text-[14px] font-semibold transition active:scale-[0.98]"
            style={{ background: v("accent"), color: "#1a0f00" }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M3 17l14-14M3 17h7M3 17V10" />
            </svg>
            Open in Google Maps
          </a>
        </div>
      )}

      {error && (
        <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "rgba(239, 68, 68, 0.14)", color: "#fca5a5", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
