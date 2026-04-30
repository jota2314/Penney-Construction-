"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { v } from "./tokens";
import type { WeekSchedulePhase } from "@/lib/actions/daily-logs";
import { backfillProjectCoordinates } from "@/lib/actions/geocode";

type ViewMode = "week" | "day" | "list" | "map";

function colorFromId(id: string): string {
  const palette = ["#D97706", "#0E7490", "#7C3AED", "#DC2626", "#059669", "#0891B2", "#B45309", "#0F766E"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function initials(first: string, last: string): string {
  return ((first?.[0] || "?") + (last?.[0] || "")).toUpperCase();
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildWeekDays(weekStartIso: string): Date[] {
  const start = new Date(weekStartIso + "T00:00:00");
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function phasesOnDate(phases: WeekSchedulePhase[], date: Date): WeekSchedulePhase[] {
  const k = dateKey(date);
  return phases.filter((p) => p.start_date <= k && p.end_date >= k);
}

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------------------------------------------------------------------------
// Phase card (used in Day, List, Map info window)
// ---------------------------------------------------------------------------

function PhaseCard({ p }: { p: WeekSchedulePhase }) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2"
      style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, borderLeft: `3px solid ${p.color}` }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-mono uppercase" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>
          {p.project_number}
        </div>
        {p.start_date !== p.end_date && (
          <div className="text-[10px] uppercase" style={{ color: v("quiet"), letterSpacing: "0.14em" }}>
            {new Date(p.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            {" → "}
            {new Date(p.end_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
        )}
      </div>
      <div>
        <div className="text-[14px] font-semibold leading-tight" style={{ color: v("ink") }}>{p.project_name}</div>
        <div className="text-[12px] mt-0.5" style={{ color: v("muted") }}>
          {p.name}
          {p.line_item_description && <span className="opacity-70"> · {p.line_item_description}</span>}
        </div>
      </div>
      {(p.project_address || p.project_city) && (
        <div className="text-[11px]" style={{ color: v("muted") }}>
          {[p.project_address, p.project_city].filter(Boolean).join(", ")}
        </div>
      )}
      {p.crew.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>Crew</span>
          {p.crew.map((c) => (
            <span
              key={c.id}
              title={`${c.first_name} ${c.last_name}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
              style={{ background: `${colorFromId(c.id)}22`, border: `1px solid ${colorFromId(c.id)}55`, color: colorFromId(c.id) }}
            >
              <span
                className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                style={{ background: colorFromId(c.id) }}
              >
                {initials(c.first_name, c.last_name)}
              </span>
              {c.first_name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map view
// ---------------------------------------------------------------------------

type MapPin = {
  project_id: string;
  project_name: string;
  project_number: string;
  lat: number;
  lng: number;
  phases: WeekSchedulePhase[];
};

function buildPins(phases: WeekSchedulePhase[]): MapPin[] {
  const byProject = new Map<string, MapPin>();
  for (const p of phases) {
    if (p.project_lat == null || p.project_lng == null) continue;
    // Supabase returns numeric columns as strings — coerce to number.
    const lat = typeof p.project_lat === "number" ? p.project_lat : Number(p.project_lat);
    const lng = typeof p.project_lng === "number" ? p.project_lng : Number(p.project_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const existing = byProject.get(p.project_id);
    if (existing) {
      existing.phases.push(p);
    } else {
      byProject.set(p.project_id, {
        project_id: p.project_id,
        project_name: p.project_name,
        project_number: p.project_number,
        lat,
        lng,
        phases: [p],
      });
    }
  }
  return Array.from(byProject.values());
}

function MapView({ phases }: { phases: WeekSchedulePhase[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapPin | null>(null);
  const [pendingGeocode, startGeocode] = useTransition();

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  const pins = useMemo(() => buildPins(phases), [phases]);
  const missing = phases.filter((p) => p.project_lat == null || p.project_lng == null);
  const missingProjectCount = new Set(missing.map((m) => m.project_id)).size;

  useEffect(() => {
    if (!ref.current || !apiKey) return;
    let cancelled = false;
    let mapInstance: google.maps.Map | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markers: any[] = [];

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
          : { lat: 42.5048, lng: -70.8967 }; // Beverly, MA fallback

        mapInstance = new MapsMap(ref.current, {
          center,
          zoom: pins.length > 1 ? 9 : 12,
          mapId: "PENNEY_SCHEDULE_DARK", // required for AdvancedMarkerElement
          disableDefaultUI: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });

        if (pins.length > 1) {
          const bounds = new google.maps.LatLngBounds();
          pins.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
          mapInstance.fitBounds(bounds, 60);
        }

        for (const pin of pins) {
          // The PinElement is the only thing in the marker's bounding box —
          // that way Google anchors the bottom-tip of the pin exactly at the
          // lat/lng. The text label is absolutely positioned outside the box
          // so it doesn't shift the anchor when the map zooms.
          const pinGlyph = new PinElement({
            background: "#D97706",
            borderColor: "#1a0f00",
            glyphColor: "#1a0f00",
            scale: 1.0,
          });

          // The pin glyph alone is the marker content. AdvancedMarkerElement
          // anchors the bottom-center of `content` at the lat/lng — and the
          // bottom-center of the pin SVG IS the pin's tip. No CSS mutation
          // on Google's element.
          //
          // The label is appended INSIDE the pin element (so it's part of the
          // same DOM tree the marker manages) but absolutely positioned so it
          // doesn't change the bounding box / anchor point.
          const labelEl = document.createElement("div");
          labelEl.textContent = pin.project_name;
          labelEl.style.cssText = [
            "position:absolute",
            "left:100%",
            "top:50%",
            "transform:translateY(-50%)",
            "margin-left:6px",
            "padding:3px 7px",
            "background:rgba(22,20,15,0.92)",
            "border:1px solid rgba(217,119,6,0.5)",
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

          // Make the pin element a positioning context for the absolute label.
          pinGlyph.element.style.position = "relative";
          pinGlyph.element.appendChild(labelEl);

          const m = new AdvancedMarkerElement({
            position: { lat: pin.lat, lng: pin.lng },
            map: mapInstance,
            title: `${pin.project_name} — ${pin.phases.length} ${pin.phases.length === 1 ? "phase" : "phases"}`,
            content: pinGlyph.element,
          });
          m.addListener("click", () => setSelected(pin));
          markers.push(m);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load Google Maps");
      }
    })();

    return () => {
      cancelled = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      markers.forEach((m: any) => { m.map = null; });
      mapInstance = null;
    };
  }, [apiKey, pins]);

  const runBackfill = () => {
    startGeocode(async () => {
      const res = await backfillProjectCoordinates();
      if (!res.ok) {
        setError(res.message ?? "Geocode failed");
      } else {
        // The page revalidates on success; until next nav the map will reflect after a refresh.
        window.location.reload();
      }
    });
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

      <div
        ref={ref}
        className="rounded-lg overflow-hidden"
        style={{ height: 380, background: v("bg-2"), border: `1px solid ${v("line")}` }}
      />

      {selected && (
        <div className="rounded-xl p-3" style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono uppercase" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>
              {selected.project_number} · {selected.phases.length} {selected.phases.length === 1 ? "phase" : "phases"}
            </div>
            <button onClick={() => setSelected(null)} className="text-[11px]" style={{ color: v("muted") }}>
              Close
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {selected.phases.map((p) => (
              <PhaseCard key={p.id} p={p} />
            ))}
          </div>
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

// ---------------------------------------------------------------------------
// Strip
// ---------------------------------------------------------------------------

export function ScheduleStrip({
  weekStart,
  phases,
  myEmployeeIds,
}: {
  weekStart: string;
  weekEnd: string;
  phases: WeekSchedulePhase[];
  myEmployeeIds: string[];
}) {
  const days = useMemo(() => buildWeekDays(weekStart), [weekStart]);
  const todayKey = dateKey(new Date());
  const [view, setView] = useState<ViewMode>("day");
  const [mineOnly, setMineOnly] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState<string>(
    days.find((d) => dateKey(d) === todayKey) ? todayKey : dateKey(days[0]),
  );

  const myEmpSet = useMemo(() => new Set(myEmployeeIds), [myEmployeeIds]);

  const filteredPhases = useMemo(() => {
    if (!mineOnly || myEmpSet.size === 0) return phases;
    // We don't have assigned_employee_ids on the WeekSchedulePhase shape, but
    // we do have crew (joined employees). Filter on whether crew contains me.
    return phases.filter((p) => p.crew.some((c) => myEmpSet.has(c.id)));
  }, [phases, mineOnly, myEmpSet]);

  const selectedDate = useMemo(() => {
    const found = days.find((d) => dateKey(d) === selectedDayKey);
    return found ?? days[0];
  }, [days, selectedDayKey]);

  const dayPhases = useMemo(() => phasesOnDate(filteredPhases, selectedDate), [filteredPhases, selectedDate]);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      {/* Header */}
      <div className="px-4 pt-3.5 pb-3 flex flex-col gap-3" style={{ borderBottom: `1px solid ${v("line-soft")}` }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>
              Schedule
            </div>
            <div className="text-[16px] font-semibold leading-tight mt-0.5" style={{ color: v("ink") }}>
              {days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} —{" "}
              {days[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </div>
          </div>
          {myEmpSet.size > 0 && (
            <button
              onClick={() => setMineOnly((x) => !x)}
              className="px-3 py-1 rounded-md text-[12px] font-semibold transition"
              style={{
                background: mineOnly ? v("accent") : v("bg-2"),
                color: mineOnly ? "#1a0f00" : v("muted"),
                border: `1px solid ${mineOnly ? "transparent" : v("line")}`,
              }}
            >
              {mineOnly ? "Mine only" : "All"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg self-start" style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}>
          {(["day", "week", "list", "map"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className="px-3 py-1 rounded-md text-[12px] font-semibold transition"
              style={{
                background: view === mode ? v("accent") : "transparent",
                color: view === mode ? "#1a0f00" : v("muted"),
              }}
            >
              {mode === "week" ? "Week" : mode === "day" ? "Day" : mode === "list" ? "List" : "Map"}
            </button>
          ))}
        </div>
      </div>

      {/* Week */}
      {view === "week" && (
        <div className="p-3">
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const k = dateKey(d);
              const isToday = k === todayKey;
              const items = phasesOnDate(filteredPhases, d);
              return (
                <button
                  key={k}
                  onClick={() => { setSelectedDayKey(k); setView("day"); }}
                  className="rounded-lg p-2 flex flex-col gap-1.5 text-left transition active:scale-[0.98]"
                  style={{
                    background: isToday ? "rgba(217, 119, 6, 0.10)" : v("bg-2"),
                    border: `1px solid ${isToday ? "rgba(217, 119, 6, 0.45)" : v("line")}`,
                    minHeight: 96,
                  }}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-medium uppercase" style={{ color: isToday ? v("accent") : v("quiet"), letterSpacing: "0.14em" }}>
                      {DOW_SHORT[(d.getDay() + 6) % 7]}
                    </span>
                    <span className="text-[14px] font-semibold tabular-nums" style={{ color: isToday ? v("accent") : v("ink") }}>
                      {d.getDate()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 min-h-0 flex-1">
                    {items.slice(0, 3).map((p) => (
                      <div key={p.id} className="rounded text-[10px] leading-tight px-1.5 py-1 truncate" style={{ background: `${p.color}22`, borderLeft: `2px solid ${p.color}`, color: v("ink") }}>
                        <div className="font-semibold truncate">{p.project_name}</div>
                        <div className="opacity-70 truncate">{p.name}</div>
                      </div>
                    ))}
                    {items.length > 3 && <div className="text-[10px]" style={{ color: v("quiet") }}>+{items.length - 3} more</div>}
                    {items.length === 0 && <div className="text-[10px] italic" style={{ color: v("quiet") }}>—</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Day */}
      {view === "day" && (
        <div className="p-3 flex flex-col gap-3">
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {days.map((d) => {
              const k = dateKey(d);
              const isSelected = k === selectedDayKey;
              const isToday = k === todayKey;
              const count = phasesOnDate(filteredPhases, d).length;
              return (
                <button
                  key={k}
                  onClick={() => setSelectedDayKey(k)}
                  className="flex flex-col items-center px-3 py-1.5 rounded-lg flex-shrink-0 transition"
                  style={{
                    background: isSelected ? v("accent") : v("bg-2"),
                    border: `1px solid ${isSelected ? "transparent" : isToday ? "rgba(217, 119, 6, 0.35)" : v("line")}`,
                    color: isSelected ? "#1a0f00" : isToday ? v("accent") : v("ink"),
                    minWidth: 56,
                  }}
                >
                  <span className="text-[10px] font-medium uppercase" style={{ letterSpacing: "0.14em" }}>{DOW_SHORT[(d.getDay() + 6) % 7]}</span>
                  <span className="text-[16px] font-semibold tabular-nums leading-none mt-0.5">{d.getDate()}</span>
                  {count > 0 && <span className="text-[9px] mt-1 opacity-70">{count} {count === 1 ? "job" : "jobs"}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2">
            {dayPhases.length === 0 ? (
              <div className="rounded-lg px-4 py-8 text-center" style={{ background: v("bg-2"), border: `1px dashed ${v("line")}`, color: v("muted") }}>
                <div className="text-[13px]">{mineOnly ? "Nothing assigned to you" : "Nothing scheduled"}</div>
                <div className="text-[11px] opacity-70 mt-1">{selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
              </div>
            ) : (
              dayPhases.map((p) => <PhaseCard key={p.id} p={p} />)
            )}
          </div>
        </div>
      )}

      {/* List */}
      {view === "list" && (
        <div className="p-3 flex flex-col gap-2">
          {filteredPhases.length === 0 ? (
            <div className="rounded-lg px-4 py-8 text-center" style={{ background: v("bg-2"), border: `1px dashed ${v("line")}`, color: v("muted") }}>
              <div className="text-[13px]">Nothing scheduled this week{mineOnly ? " for you" : ""}</div>
            </div>
          ) : (
            filteredPhases.map((p) => <PhaseCard key={p.id} p={p} />)
          )}
        </div>
      )}

      {/* Map */}
      {view === "map" && (
        <div className="p-3">
          <MapView phases={filteredPhases} />
        </div>
      )}
    </div>
  );
}
