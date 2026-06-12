"use client";

import { useEffect, useRef, useState } from "react";
import { v } from "./tokens";

const GEOFENCE_METERS = 150; // ~500 ft

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtFeet(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.round(feet)} ft`;
  return `${(feet / 5280).toFixed(1)} mi`;
}

type Fix = { lat: number; lng: number; accuracy: number };

export function LiveLocationCard({
  jobName,
  jobLat,
  jobLng,
}: {
  jobName?: string | null;
  jobLat?: number | null;
  jobLng?: number | null;
}) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [agoSec, setAgoSec] = useState<number | null>(null);
  const watchRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("This device can't share location.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setFix({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        });
        setUpdatedAt(Date.now());
        setAgoSec(0);
        setError(null);
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked. Allow location for this app, then reopen."
            : "Couldn't get a location fix — check signal/GPS.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    watchRef.current = id;
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  // Tick "updated Xs ago" every second — this is what visibly freezes when the
  // app is backgrounded and jumps forward when you reopen it.
  useEffect(() => {
    if (updatedAt == null) return;
    const t = window.setInterval(() => {
      setAgoSec(Math.floor((Date.now() - updatedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [updatedAt]);

  const hasJob = jobLat != null && jobLng != null;
  const dist = fix && hasJob ? distanceMeters(fix.lat, fix.lng, jobLat!, jobLng!) : null;
  const onSite = dist != null && dist <= GEOFENCE_METERS;

  const accent = error
    ? "#fca5a5"
    : onSite
      ? "#34d399"
      : dist != null
        ? "#fbbf24"
        : v("ink");

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2"
      style={{
        background: v("card"),
        border: `1px solid ${onSite ? "rgba(16,185,129,0.35)" : v("line")}`,
      }}
    >
      <div className="flex items-center justify-between">
        <div
          className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase"
          style={{ color: v("quiet"), letterSpacing: "0.16em" }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: error ? "#ef4444" : "#10b981",
              boxShadow: error ? "none" : "0 0 6px #10b981",
            }}
          />
          Live location
        </div>
        {agoSec != null && !error && (
          <span className="text-[11px] font-mono" style={{ color: v("quiet") }}>
            updated {agoSec === 0 ? "now" : `${agoSec}s ago`}
          </span>
        )}
      </div>

      {error ? (
        <div className="text-[13px] leading-snug" style={{ color: "#fca5a5" }}>
          {error}
        </div>
      ) : !fix ? (
        <div className="text-[14px]" style={{ color: v("muted") }}>
          Getting your location…
        </div>
      ) : (
        <>
          <div className="text-[22px] font-semibold tracking-tight" style={{ color: accent }}>
            {hasJob
              ? onSite
                ? "✓ On site"
                : `${dist != null ? fmtFeet(dist) : ""} from ${jobName ?? "job"}`
              : "Located"}
          </div>
          <div className="text-[12px] font-mono" style={{ color: v("quiet") }}>
            {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)} · ±{Math.round(fix.accuracy)}m
            {!hasJob && (
              <span style={{ color: v("muted") }}> · no job pin set</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
