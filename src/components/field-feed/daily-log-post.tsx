"use client";

import { useState } from "react";
import { v } from "./tokens";
import type { FeedDailyLog } from "@/lib/actions/daily-logs";

function initials(name: string | null, email: string | null): string {
  const src = name?.trim() || email?.split("@")[0] || "?";
  const parts = src.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFromId(id: string): string {
  const palette = ["#D97706", "#0E7490", "#7C3AED", "#DC2626", "#059669", "#0891B2", "#B45309", "#0F766E"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (diff < 86400 * 7) {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function hoursBetween(startedAt: string, endedAt: string): string {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const REACTIONS = ["👍", "🔥", "💪"] as const;

export function DailyLogPost({ log }: { log: FeedDailyLog }) {
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [reacted, setReacted] = useState<Record<string, boolean>>({});
  const [photoIdx, setPhotoIdx] = useState(0);

  const react = (e: string) => {
    setReacted((r) => ({ ...r, [e]: !r[e] }));
    setReactions((r) => ({ ...r, [e]: (r[e] ?? 0) + (reacted[e] ? -1 : 1) }));
  };

  const isLive = log.status === "in_progress";
  const photos = log.photo_signed_urls;
  const authorLabel = log.author_name?.trim() || log.author_email?.split("@")[0] || "Someone";
  const avatarBg = colorFromId(log.author_id);
  const avatarInit = initials(log.author_name, log.author_email);

  if (isLive) {
    return (
      <div
        className="rounded-2xl p-4 flex items-center gap-3"
        style={{
          background: "linear-gradient(135deg, rgba(52, 211, 153, 0.08), transparent)",
          border: "1px solid rgba(52, 211, 153, 0.30)",
        }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-white"
          style={{ background: avatarBg, fontSize: 11, letterSpacing: "0.04em" }}
        >
          {avatarInit}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-medium uppercase" style={{ color: "#34d399", letterSpacing: "0.18em" }}>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
              Clocked in · {fmtTime(log.started_at)}
            </span>
          </div>
          <div className="text-[14px] font-semibold leading-tight mt-0.5 truncate" style={{ color: v("ink") }}>
            {authorLabel} on {log.project_name}
          </div>
          <div className="text-[12px] truncate" style={{ color: v("muted") }}>
            {log.phase_name}{log.line_item_description ? ` · ${log.line_item_description}` : ""}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
      <div className="px-4 pt-3.5 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-white"
          style={{ background: avatarBg, fontSize: 11, letterSpacing: "0.04em" }}
        >
          {avatarInit}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold leading-tight" style={{ color: v("ink") }}>
            {authorLabel}
          </div>
          <div className="text-[11px] font-mono truncate" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>
            {log.project_name} · {fmtTime(log.started_at)}
          </div>
        </div>
        {log.ended_at && (
          <div className="flex flex-col items-end flex-shrink-0">
            <div className="text-[10px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>Hours</div>
            <div className="text-[14px] font-semibold" style={{ color: v("ink"), fontVariantNumeric: "tabular-nums" }}>
              {hoursBetween(log.started_at, log.ended_at)}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pt-2 pb-1">
        <span
          className="inline-block text-[10px] font-medium uppercase px-2 py-0.5 rounded"
          style={{ background: "rgba(217, 119, 6, 0.14)", color: v("accent"), letterSpacing: "0.14em" }}
        >
          {log.phase_name}
        </span>
        {log.line_item_description && (
          <span className="text-[12px] ml-2" style={{ color: v("muted") }}>
            {log.line_item_description}
          </span>
        )}
      </div>

      {log.text && (
        <div className="px-4 pt-2 pb-3 text-[15px] leading-snug whitespace-pre-wrap" style={{ color: v("ink") }}>
          {log.text}
        </div>
      )}

      {photos.length > 0 && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[photoIdx]}
            alt="Daily log photo"
            className="w-full aspect-[4/3] object-cover"
            style={{ background: v("bg-2") }}
          />
          {photos.length > 1 && (
            <>
              <button
                onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
                aria-label="Previous photo"
              >
                ‹
              </button>
              <button
                onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
                aria-label="Next photo"
              >
                ›
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {photos.map((_, i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: i === photoIdx ? "#fff" : "rgba(255,255,255,0.4)" }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="px-3 pt-2 pb-3 flex items-center gap-2" style={{ borderTop: `1px solid ${v("line-soft")}` }}>
        {REACTIONS.map((e) => (
          <button
            key={e}
            onClick={() => react(e)}
            className="px-2.5 py-1 rounded-full flex items-center gap-1 text-[12px] transition active:scale-95"
            style={{
              background: reactions[e] ? "rgba(217, 119, 6, 0.14)" : v("bg-2"),
              border: `1px solid ${reactions[e] ? "rgba(217, 119, 6, 0.35)" : v("line")}`,
              color: reactions[e] ? v("accent") : v("muted"),
            }}
          >
            <span>{e}</span>
            {(reactions[e] ?? 0) > 0 && <span className="font-semibold">{reactions[e]}</span>}
          </button>
        ))}
        <div className="ml-auto text-[11px] font-mono" style={{ color: v("quiet") }}>
          {log.project_name.slice(0, 18)}
        </div>
      </div>
    </div>
  );
}
