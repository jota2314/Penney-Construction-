"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { v } from "./tokens";
import { backfillProjectCoordinates } from "@/lib/actions/geocode";
import { getLiveCrewPositions, type LiveCrewPosition } from "@/lib/actions/live-map";
import { formatDistance } from "@/lib/crew/geo";

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

/** Someone on the clock, for the roster under the map. */
export type ClockedInRow = {
  /** daily_logs.id — the same id the live crew positions carry. */
  id: string;
  name: string;
  projectName: string | null;
  /** Labor cost so far, already formatted. Omitted for viewers who can't see pay. */
  amount?: string;
};

/** Zoom at which every pin gets its label; below it only the busy ones do. */
const LABEL_ZOOM = 12;

/**
 * Pin label: the job name without its trailing street address
 * ("Rand Kitchen & Bath — 7 Hamilton St" → "Rand Kitchen & Bath"). The full
 * name and address are on the card that opens when the pin is tapped.
 */
function shortLabel(name: string): string {
  const head = name.replace(/\s+[—–-]\s+\d.*$/, "").trim() || name;
  return head.length > 28 ? `${head.slice(0, 27).trimEnd()}…` : head;
}

/** Jobs at the same address share a key (4 decimals is about 10 m). */
function spotKey(pin: { lat: number; lng: number }): string {
  return `${pin.lat.toFixed(4)},${pin.lng.toFixed(4)}`;
}

type RouteEndpoint =
  | { kind: "myLocation" }
  | { kind: "address"; address: string; lat?: number; lng?: number }
  | { kind: "lastStop" };

// ---------------------------------------------------------------------------
// Live crew layer
// ---------------------------------------------------------------------------

/**
 * Geofence state is three-valued on purpose: with no jobsite on the log there
 * is nothing to measure against, and drawing that as "on site" would assert
 * something we don't know.
 */
type SiteState = "on" | "off" | "unknown";

const SITE_COLOR: Record<SiteState, string> = {
  on: "#10b981",
  off: "#f59e0b",
  unknown: "#78716C",
};

function siteState(pos: LiveCrewPosition): SiteState {
  if (pos.on_site === true) return "on";
  if (pos.on_site === false) return "off";
  return "unknown";
}

function crewColor(id: string): string {
  const palette = ["#D97706", "#0E7490", "#7C3AED", "#DC2626", "#059669", "#0891B2", "#B45309", "#0F766E"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function nameParts(full: string): { first: string; initials: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return {
    first,
    initials: ((first[0] ?? "?") + (last[0] ?? "")).toUpperCase(),
  };
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Crew avatar marker: initials disc ringed by geofence state, name beneath. */
function crewMarkerEl(pos: LiveCrewPosition): HTMLElement {
  const { first, initials } = nameParts(pos.name);
  const ring = SITE_COLOR[siteState(pos)];

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;display:flex;flex-direction:column;align-items:center";

  const disc = document.createElement("div");
  disc.textContent = initials;
  disc.title = `${pos.name}${pos.project_name ? ` · ${pos.project_name}` : ""}`;
  disc.style.cssText = [
    "width:30px",
    "height:30px",
    "border-radius:50%",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    `background:${crewColor(pos.profile_id)}`,
    `border:3px solid ${ring}`,
    "color:#ffffff",
    "font-family:var(--font-geist-sans),-apple-system,sans-serif",
    "font-size:11px",
    "font-weight:700",
    `box-shadow:0 0 0 3px ${ring}33,0 2px 6px rgba(0,0,0,0.5)`,
  ].join(";");

  const tag = document.createElement("div");
  tag.textContent = first;
  tag.style.cssText = [
    "margin-top:3px",
    "padding:1px 5px",
    "border-radius:4px",
    "background:rgba(22,20,15,0.92)",
    `border:1px solid ${ring}88`,
    "color:#F5F1EA",
    "font-family:var(--font-geist-sans),-apple-system,sans-serif",
    "font-size:10px",
    "font-weight:600",
    "white-space:nowrap",
  ].join(";");

  wrap.appendChild(disc);
  wrap.appendChild(tag);
  return wrap;
}

export function MapView({
  pins,
  missingProjectCount = 0,
  height = 380,
  liveCrew = false,
  routeOnTap = false,
  jobLinks = false,
  clockedIn,
}: {
  pins: MapPin[];
  missingProjectCount?: number;
  /** Map canvas height — px number, or any CSS length (e.g. a clamp/vh value). */
  height?: number | string;
  /** Plot clocked-in crew at their real GPS position, polled while mounted. */
  liveCrew?: boolean;
  /** Tapping a pin also adds it to the route (the runner's map). */
  routeOnTap?: boolean;
  /** Show an "Open job" link on the pin card (office pages only). */
  jobLinks?: boolean;
  /**
   * Everyone on the clock. Adds each person's cost to the roster and lists
   * the people whose phone has sent no location, who can't be plotted.
   */
  clockedIn?: ClockedInRow[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Map<string, { marker: any; pin: any; label: HTMLElement; name: string }>
  >(new Map());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crewMarkersRef = useRef<Map<string, any>>(new Map());
  const [crew, setCrew] = useState<LiveCrewPosition[]>([]);
  const [crewLoaded, setCrewLoaded] = useState(false);
  const [showCrew, setShowCrew] = useState(true);
  // Ref writes don't re-render, so the crew effect needs an explicit signal
  // that the Google map instance now exists.
  const [mapReady, setMapReady] = useState(0);
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

  // The Google map is rebuilt only when a pin is added, removed, moved or
  // renamed. Pages that refresh their data hand over a new array every time;
  // that must not throw away the zoom and the route the user is looking at.
  const pinsKey = useMemo(
    () => pins.map((p) => `${p.project_id}:${p.lat}:${p.lng}:${p.project_name}`).join("|"),
    [pins],
  );
  const pinsRef = useRef(pins);
  // What paintPins needs from the latest render, readable from map listeners.
  const viewRef = useRef({
    selectedIds,
    focusedId,
    crewCounts: new Map<string, number>(),
  });

  /** Colour, size and label of every job pin, for the current zoom and state. */
  const paintPins = useCallback(() => {
    const zoom = mapRef.current?.getZoom() ?? 0;
    const view = viewRef.current;
    markersRef.current.forEach(({ marker, pin, label, name }, projectId) => {
      const isSelected = view.selectedIds.has(projectId);
      const isFocused = view.focusedId === projectId;
      const count = view.crewCounts.get(projectId) ?? 0;
      pin.background = isSelected ? "#10b981" : "#D97706";
      pin.borderColor = isSelected ? "#06291f" : "#1a0f00";
      pin.glyphColor = isSelected ? "#06291f" : "#1a0f00";
      pin.scale = isFocused ? 1.3 : 1.0;
      marker.zIndex = isFocused ? 300 : count > 0 ? 200 : isSelected ? 150 : 100;
      label.textContent = count > 0 ? `${name} · ${count} crew` : name;
      label.style.border =
        count > 0
          ? "1px solid rgba(16,185,129,0.65)"
          : "1px solid rgba(217,119,6,0.5)";
      // Zoomed out, 30 labels pile into one unreadable block. Show only the
      // sites with crew on them plus whatever the user picked.
      label.style.display =
        zoom >= LABEL_ZOOM || count > 0 || isSelected || isFocused ? "block" : "none";
    });
  }, []);

  const toggleStop = useCallback((projectId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
    // Changing the stops invalidates the previously-built route
    setRouteResult(null);
    if (rendererRef.current) {
      rendererRef.current.setMap(null);
      rendererRef.current = null;
    }
  }, []);

  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

  useEffect(() => {
    if (!ref.current || !apiKey) return;
    const pins = pinsRef.current;
    let cancelled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

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

        // A Map constructed while the page is still hydrating can silently
        // wedge: the instance exists, no error fires, but the view never
        // paints (grey box). Wait two frames so layout has settled first.
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
        if (cancelled || !ref.current) return;

        const center = pins.length
          ? { lat: pins[0].lat, lng: pins[0].lng }
          : { lat: 42.5048, lng: -70.8967 };

        const buildMap = (): google.maps.Map => {
          const container = ref.current!;
          // Google binds internals to the div it was constructed on and a
          // wedged map never recovers there — every attempt gets a fresh host.
          container.replaceChildren();
          const host = document.createElement("div");
          host.style.width = "100%";
          host.style.height = "100%";
          container.appendChild(host);

          const mapInstance = new MapsMap(host, {
            center,
            zoom: pins.length > 1 ? 9 : 12,
            mapId: "PENNEY_SCHEDULE_DARK",
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
          mapRef.current = mapInstance;
          setMapReady((n) => n + 1);
          mapInstance.addListener("zoom_changed", paintPins);
          // Tapping empty map closes the pin card.
          mapInstance.addListener("click", () => setFocusedId(null));

          if (pins.length > 1) {
            const bounds = new google.maps.LatLngBounds();
            pins.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
            mapInstance.fitBounds(bounds, 60);
          }
          return mapInstance;
        };

        const addMarkers = (mapInstance: google.maps.Map) => {
          markersRef.current.forEach(({ marker }) => { marker.map = null; });
          markersRef.current.clear();
          crewMarkersRef.current.forEach((m) => { m.map = null; });
          crewMarkersRef.current.clear();

          for (const pin of pins) {
          const pinGlyph = new PinElement({
            background: "#D97706",
            borderColor: "#1a0f00",
            glyphColor: "#1a0f00",
            scale: 1.0,
          });

          const labelEl = document.createElement("div");
          labelEl.style.cssText = [
            "position:absolute",
            "left:100%",
            "top:50%",
            "transform:translateY(-50%)",
            "margin-left:6px",
            "padding:3px 7px",
            "background:rgba(22,20,15,0.92)",
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

          // Google's pin is now a web component (<gmp-pin>) with a shadow
          // root, so a label appended inside it is never drawn. The label
          // lives beside the pin in a wrapper of our own instead.
          const wrap = document.createElement("div");
          wrap.style.cssText = "position:relative;display:flex";
          // Newer Maps versions: the PinElement is the node itself and
          // `.element` is deprecated. Older ones only have `.element`.
          const pinNode: Node =
            (pinGlyph as unknown) instanceof Node
              ? (pinGlyph as unknown as Node)
              : pinGlyph.element;
          wrap.appendChild(pinNode);
          wrap.appendChild(labelEl);

          const m = new AdvancedMarkerElement({
            position: { lat: pin.lat, lng: pin.lng },
            map: mapInstance,
            title: pin.project_name,
            content: wrap,
          });
          m.addListener("click", () => {
            setFocusedId(pin.project_id);
            if (routeOnTap) toggleStop(pin.project_id);
          });
          markersRef.current.set(pin.project_id, {
            marker: m,
            pin: pinGlyph,
            label: labelEl,
            name: shortLabel(pin.project_name),
          });
          }
          paintPins();
        };

        let mapInstance = buildMap();
        addMarkers(mapInstance);

        // Watchdog: if the map never paints its first tiles while the tab is
        // visible, it's wedged — rebuild it from scratch (rebuilt maps render
        // fine; seen in prod Aug 2026 on /command-center/map).
        let rebuilds = 0;
        const armWatchdog = (instance: google.maps.Map) => {
          let painted = false;
          google.maps.event.addListenerOnce(instance, "tilesloaded", () => {
            painted = true;
          });
          const check = () => {
            if (cancelled || painted || !ref.current) return;
            if (document.visibilityState !== "visible") {
              // Hidden tabs don't paint at all — that's not a wedged map.
              watchdog = setTimeout(check, 4000);
              return;
            }
            if (rebuilds >= 2) return;
            rebuilds += 1;
            mapInstance = buildMap();
            addMarkers(mapInstance);
            armWatchdog(mapInstance);
          };
          watchdog = setTimeout(check, 4000);
        };
        armWatchdog(mapInstance);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load Google Maps");
      }
    })();

    const markers = markersRef.current;
    return () => {
      cancelled = true;
      if (watchdog) clearTimeout(watchdog);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      markers.forEach(({ marker }: { marker: any }) => { marker.map = null; });
      markers.clear();
      if (rendererRef.current) {
        rendererRef.current.setMap(null);
        rendererRef.current = null;
      }
      mapRef.current = null;
    };
  }, [apiKey, pinsKey, routeOnTap, paintPins, toggleStop]);

  // Repaint pins when the selection, the open card or the crew counts change
  // (selected = green, crew on the clock = green-edged label).
  useEffect(() => {
    const crewCounts = new Map<string, number>();
    for (const p of pins) crewCounts.set(p.project_id, p.liveCrew?.length ?? 0);
    viewRef.current = { selectedIds, focusedId, crewCounts };
    paintPins();
  }, [pins, selectedIds, focusedId, mapReady, paintPins]);

  // Poll live crew positions — phones ping while a shift is open, so a map
  // left up on a desk should keep up rather than freeze at load time.
  useEffect(() => {
    if (!liveCrew) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await getLiveCrewPositions();
        if (!cancelled) {
          setCrew(rows);
          setCrewLoaded(true);
        }
      } catch {
        if (!cancelled) setCrewLoaded(true);
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [liveCrew]);

  // Crew avatar layer — moved in place between polls so markers don't flicker.
  useEffect(() => {
    if (!liveCrew) return;
    let cancelled = false;
    if (!mapRef.current || !apiKey) return;

    (async () => {
      const { setOptions, importLibrary } = await import("@googlemaps/js-api-loader");
      setOptions({ key: apiKey, v: "weekly" });
      const markerLib = (await importLibrary("marker")) as google.maps.MarkerLibrary;
      const { AdvancedMarkerElement } = markerLib;
      if (cancelled || !mapRef.current) return;

      const live = showCrew ? crew : [];
      const seen = new Set(live.map((c) => c.daily_log_id));

      crewMarkersRef.current.forEach((marker, id) => {
        if (!seen.has(id)) {
          marker.map = null;
          crewMarkersRef.current.delete(id);
        }
      });

      for (const pos of live) {
        const existing = crewMarkersRef.current.get(pos.daily_log_id);
        if (existing) {
          existing.position = { lat: pos.lat, lng: pos.lng };
          existing.content = crewMarkerEl(pos);
        } else {
          crewMarkersRef.current.set(
            pos.daily_log_id,
            new AdvancedMarkerElement({
              position: { lat: pos.lat, lng: pos.lng },
              map: mapRef.current,
              title: pos.name,
              content: crewMarkerEl(pos),
              zIndex: 500,
            }),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [crew, showCrew, apiKey, mapReady, liveCrew]);

  // Drop crew markers when this map unmounts.
  useEffect(() => {
    const markers = crewMarkersRef.current;
    return () => {
      markers.forEach((m) => {
        m.map = null;
      });
      markers.clear();
    };
  }, []);

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
      if (res.message) setError(res.message);
      // Partial runs still pinned some jobs — reload so those show up.
      if (res.updated > 0) window.location.reload();
      else if (!res.message) setError("Geocode failed");
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
      // error_message is where Google explains billing/API-enablement problems.
      if (data.error_message) throw new Error(`${data.status}: ${data.error_message}`);
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
  const offSiteCount = crew.filter((c) => c.on_site === false).length;
  const focusedPin = focusedId ? pins.find((p) => p.project_id === focusedId) ?? null : null;
  // Other jobs at the same address sit under this pin and can't be tapped.
  const samePlace = focusedPin
    ? pins.filter((p) => p.project_id !== focusedPin.project_id && spotKey(p) === spotKey(focusedPin))
    : [];
  const amountById = new Map((clockedIn ?? []).map((r) => [r.id, r.amount]));
  const plottedIds = new Set(crew.map((c) => c.daily_log_id));
  // On the clock, but the phone has sent no location to plot.
  const unplotted = crewLoaded ? (clockedIn ?? []).filter((r) => !plottedIds.has(r.id)) : [];
  const onClockCount = crew.length + unplotted.length;

  const fitToCrew = () => {
    if (!mapRef.current || crew.length === 0) return;
    if (crew.length === 1) {
      mapRef.current.panTo({ lat: crew[0].lat, lng: crew[0].lng });
      mapRef.current.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    crew.forEach((c) => bounds.extend({ lat: c.lat, lng: c.lng }));
    mapRef.current.fitBounds(bounds, 80);
  };

  const fitToJobs = () => {
    if (!mapRef.current || pins.length === 0) return;
    if (pins.length === 1) {
      mapRef.current.panTo({ lat: pins[0].lat, lng: pins[0].lng });
      mapRef.current.setZoom(12);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    pins.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    mapRef.current.fitBounds(bounds, 60);
  };

  const toolBtn = "px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-[12px] font-semibold transition active:scale-[0.98]";
  const plainBtn = { background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` };

  return (
    <div className="flex flex-col gap-2">
      {missingProjectCount > 0 && (
        <div
          className="rounded-lg px-3 py-2 flex items-center justify-between gap-3 text-[12px]"
          style={{ background: "rgba(217, 119, 6, 0.08)", border: "1px solid rgba(217, 119, 6, 0.25)", color: "#fbbf24" }}
        >
          <span>
            <span className="font-semibold">{missingProjectCount}</span>
            {missingProjectCount === 1
              ? " jobsite is missing coordinates and won't show on the map."
              : " jobsites are missing coordinates and won't show on the map."}
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

      {/* One toolbar: crew layer, zoom shortcuts, my location */}
      <div className="flex items-center gap-2 flex-wrap">
        {liveCrew && (
          <button
            onClick={() => setShowCrew((s) => !s)}
            className={toolBtn}
            style={{
              background: showCrew ? "rgba(16, 185, 129, 0.16)" : v("bg-2"),
              color: showCrew ? "#34d399" : v("muted"),
              border: `1px solid ${showCrew ? "rgba(16, 185, 129, 0.45)" : v("line")}`,
            }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-3.5 h-3.5">
              <circle cx="7.5" cy="6.5" r="2.75" />
              <path d="M2.5 16c0-2.8 2.24-4.5 5-4.5s5 1.7 5 4.5" />
              <path d="M13.5 4.2a2.75 2.75 0 010 4.6M15 11.8c1.6.6 2.5 2 2.5 4.2" />
            </svg>
            {showCrew ? `Crew on map · ${crew.length}` : "Crew hidden"}
          </button>
        )}

        {liveCrew && showCrew && crew.length > 0 && (
          <button onClick={fitToCrew} className={toolBtn} style={plainBtn}>
            Zoom to crew
          </button>
        )}

        {pins.length > 0 && (
          <button onClick={fitToJobs} className={toolBtn} style={plainBtn}>
            All jobs
          </button>
        )}

        <button
          onClick={() => setTracking((t) => !t)}
          className={toolBtn}
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
          {tracking ? (myPosition ? "Tracking · live" : "Locating…") : "Show me"}
        </button>
        {tracking && myPosition && (
          <button onClick={recenterOnMe} className={toolBtn} style={plainBtn}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-3.5 h-3.5">
              <circle cx="10" cy="10" r="3" />
              <path d="M10 1v3M10 16v3M1 10h3M16 10h3" />
            </svg>
            Center on me
          </button>
        )}

        {liveCrew && showCrew && offSiteCount > 0 && (
          <span
            className="px-2 py-1 rounded-md text-[11px] font-semibold"
            style={{
              background: "rgba(245, 158, 11, 0.15)",
              color: "#fbbf24",
              border: "1px solid rgba(245, 158, 11, 0.4)",
            }}
          >
            {offSiteCount} off site
          </span>
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

      {error && (
        <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "rgba(239, 68, 68, 0.14)", color: "#fca5a5", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
          {error}
        </div>
      )}

      {/* Pin card: what this job is, who is there, and what you can do */}
      {focusedPin && (
        <div
          className="rounded-xl p-3 flex flex-col gap-2.5"
          style={{ background: v("card"), border: "1px solid rgba(217, 119, 6, 0.40)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold" style={{ color: v("ink") }}>
                {focusedPin.project_name}
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: v("muted") }}>
                {[focusedPin.project_number, focusedPin.address].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button
              onClick={() => setFocusedId(null)}
              aria-label="Close"
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[15px]"
              style={{ background: v("bg-2"), color: v("muted"), border: `1px solid ${v("line")}` }}
            >
              ×
            </button>
          </div>

          {(focusedPin.liveCrew?.length ?? 0) > 0 && (
            <div className="text-[12px]" style={{ color: "#34d399" }}>
              On the clock here: {focusedPin.liveCrew!.join(", ")}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => toggleStop(focusedPin.project_id)}
              className={toolBtn}
              style={
                selectedIds.has(focusedPin.project_id)
                  ? { background: "rgba(16, 185, 129, 0.16)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.45)" }
                  : { background: v("accent"), color: "#1a0f00", border: "1px solid transparent" }
              }
            >
              {selectedIds.has(focusedPin.project_id) ? "In route · remove" : "Add to route"}
            </button>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${focusedPin.lat},${focusedPin.lng}&travelmode=driving`}
              target="_blank"
              rel="noopener noreferrer"
              className={toolBtn}
              style={plainBtn}
            >
              Directions
            </a>
            {jobLinks && (
              <Link href={`/projects/${focusedPin.project_id}`} className={toolBtn} style={plainBtn}>
                Open job
              </Link>
            )}
          </div>

          {samePlace.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px]" style={{ color: v("muted") }}>
                Same address:
              </span>
              {samePlace.map((p) => (
                <button
                  key={p.project_id}
                  onClick={() => setFocusedId(p.project_id)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium"
                  style={plainBtn}
                >
                  {p.project_name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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

      {!focusedPin && selectedPins.length === 0 && !routeResult && pins.length > 0 && (
        <div className="px-1 text-[12px]" style={{ color: v("muted") }}>
          {routeOnTap
            ? "Tap pins to add stops. Build Route picks the smartest order."
            : "Tap a pin for the job, directions, or to add it to a route."}
        </div>
      )}

      {/* Who's on the clock, and whether they're actually where they claim */}
      {liveCrew && (
        <div className="rounded-xl overflow-hidden" style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}>
          <div
            className="px-3 py-2 text-[10px] font-semibold uppercase"
            style={{ color: v("quiet"), letterSpacing: "0.18em", borderBottom: `1px solid ${v("line-soft")}` }}
          >
            On the clock now{onClockCount > 0 ? ` · ${onClockCount}` : ""}
          </div>
          {onClockCount === 0 ? (
            <div className="px-3 py-4 text-[12px]" style={{ color: v("muted") }}>
              {crewLoaded ? "Nobody is clocked in right now." : "Loading crew…"}
            </div>
          ) : (
            <div className="flex flex-col">
              {crew.map((c) => {
                const state = siteState(c);
                const { initials } = nameParts(c.name);
                return (
                  <button
                    key={c.daily_log_id}
                    type="button"
                    onClick={() => {
                      if (!mapRef.current) return;
                      mapRef.current.panTo({ lat: c.lat, lng: c.lng });
                      mapRef.current.setZoom(16);
                    }}
                    className="px-3 py-2 flex items-center gap-2.5 text-left transition active:scale-[0.99]"
                    style={{ borderTop: `1px solid ${v("line-soft")}` }}
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                      style={{
                        background: crewColor(c.profile_id),
                        border: `2px solid ${SITE_COLOR[state]}`,
                      }}
                    >
                      {initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate" style={{ color: v("ink") }}>
                        {c.name}
                      </div>
                      <div className="text-[11px] truncate" style={{ color: v("muted") }}>
                        {c.project_name ?? "No jobsite on the log"} · {timeAgo(c.captured_at)}
                        {!c.is_ping && " (clock-in fix)"}
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{
                        background: `${SITE_COLOR[state]}26`,
                        color: state === "on" ? "#34d399" : state === "off" ? "#fbbf24" : v("muted"),
                      }}
                    >
                      {state === "off"
                        ? c.distance_m != null
                          ? formatDistance(c.distance_m)
                          : "Off site"
                        : state === "on"
                          ? "On site"
                          : "No jobsite"}
                    </span>
                    {amountById.get(c.daily_log_id) && (
                      <span
                        className="text-[12px] font-mono font-semibold flex-shrink-0 text-right"
                        style={{ color: v("ink"), minWidth: 62 }}
                      >
                        {amountById.get(c.daily_log_id)}
                      </span>
                    )}
                  </button>
                );
              })}
              {unplotted.map((r) => (
                <div
                  key={r.id}
                  className="px-3 py-2 flex items-center gap-2.5"
                  style={{ borderTop: `1px solid ${v("line-soft")}` }}
                >
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: v("card"), color: v("muted"), border: `2px solid ${SITE_COLOR.unknown}` }}
                  >
                    {nameParts(r.name).initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate" style={{ color: v("ink") }}>
                      {r.name}
                    </div>
                    <div className="text-[11px] truncate" style={{ color: v("muted") }}>
                      {r.projectName ?? "No jobsite on the log"}
                    </div>
                  </div>
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background: `${SITE_COLOR.unknown}26`, color: v("muted") }}
                  >
                    No location
                  </span>
                  {r.amount && (
                    <span
                      className="text-[12px] font-mono font-semibold flex-shrink-0 text-right"
                      style={{ color: v("ink"), minWidth: 62 }}
                    >
                      {r.amount}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
