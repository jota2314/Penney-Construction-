"use client";

import { useEffect, useRef, useState } from "react";
import { recordPresencePing } from "@/lib/actions/daily-logs";

const PING_INTERVAL_MS = 3 * 60 * 1000; // record a presence ping at most every 3 min

/**
 * Small live-location indicator for the crew header. Tracks location in the
 * foreground and, while the worker is clocked in, logs an opportunistic
 * presence ping (the server no-ops when they're not clocked in). Replaces the
 * bulky on-screen location card with a quiet status dot.
 */
export function CrewLocationDot() {
  const [status, setStatus] = useState<"idle" | "on" | "denied">("idle");
  const lastPingRef = useRef(0);
  const watchRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setStatus("on");
        const now = Date.now();
        if (now - lastPingRef.current >= PING_INTERVAL_MS) {
          lastPingRef.current = now;
          void recordPresencePing(
            p.coords.latitude,
            p.coords.longitude,
            p.coords.accuracy,
          ).catch(() => {});
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setStatus("denied");
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
    watchRef.current = id;
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  const color = status === "on" ? "#10b981" : status === "denied" ? "#ef4444" : "#6b7280";
  const title =
    status === "on" ? "Location on" : status === "denied" ? "Location blocked" : "Finding location…";

  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center w-6 h-6"
    >
      <span
        className={`w-2 h-2 rounded-full ${status === "on" ? "animate-pulse" : ""}`}
        style={{ background: color, boxShadow: status === "on" ? `0 0 6px ${color}` : "none" }}
      />
    </span>
  );
}
