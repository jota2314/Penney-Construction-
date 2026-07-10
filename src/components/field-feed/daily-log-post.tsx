"use client";

import { useState } from "react";
import { v } from "./tokens";
import type { FeedDailyLog } from "@/lib/actions/daily-logs";
import { ImageViewer } from "@/components/ui/image-viewer";
import { useSwipeCarousel } from "@/hooks/use-swipe-carousel";

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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { handlers: swipeHandlers, trackStyle, consumeSwipe } = useSwipeCarousel({
    count: log.photo_signed_urls.length,
    index: photoIdx,
    onIndexChange: setPhotoIdx,
  });

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
    <>
      <article className="rounded-2xl overflow-hidden" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
        <header className="flex items-center gap-3 px-3 py-3">
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
            <div className="text-[11px] truncate" style={{ color: v("quiet") }}>
              {log.project_name} · {fmtTime(log.started_at)}
            </div>
          </div>
          {log.ended_at && (
            <div className="text-[12px] font-semibold flex-shrink-0" style={{ color: v("muted"), fontVariantNumeric: "tabular-nums" }}>
              {hoursBetween(log.started_at, log.ended_at)}
            </div>
          )}
        </header>

        {photos.length > 0 && (
          <div
            className="relative overflow-hidden bg-black"
            style={{ touchAction: "pan-y" }}
            {...swipeHandlers}
          >
            <div className="flex" style={trackStyle}>
              {photos.map((url, i) => (
                <button
                  key={`${url}-${i}`}
                  type="button"
                  onClick={() => {
                    if (!consumeSwipe()) setPreviewUrl(url);
                  }}
                  className="block w-full flex-shrink-0"
                  aria-label={`Open photo ${i + 1} of ${photos.length} from ${log.project_name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Field update from ${log.project_name}`}
                    draggable={false}
                    className="w-full aspect-square select-none object-cover"
                  />
                </button>
              ))}
            </div>

            {photos.length > 1 && (
              <>
                <div className="absolute right-2.5 top-2.5 rounded-full bg-black/65 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                  {photoIdx + 1}/{photos.length}
                </div>
                <button
                  type="button"
                  onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                  className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-xl text-white backdrop-blur-sm"
                  aria-label="Previous photo"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-xl text-white backdrop-blur-sm"
                  aria-label="Next photo"
                >
                  ›
                </button>
                <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5" aria-hidden="true">
                  {photos.map((_, i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full shadow-sm"
                      style={{ background: i === photoIdx ? "#fff" : "rgba(255,255,255,0.45)" }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 px-3 pt-2.5">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => react(emoji)}
              className="flex min-h-9 items-center gap-1 text-[20px] transition active:scale-90"
              aria-label={`React ${emoji}`}
              aria-pressed={!!reacted[emoji]}
            >
              <span className={reacted[emoji] ? "drop-shadow-[0_0_5px_rgba(217,119,6,0.7)]" : "grayscale-[0.35]"}>
                {emoji}
              </span>
              {(reactions[emoji] ?? 0) > 0 && (
                <span className="text-[12px] font-semibold" style={{ color: v("ink") }}>
                  {reactions[emoji]}
                </span>
              )}
            </button>
          ))}
          <span
            className="ml-auto rounded-full px-2 py-1 text-[9px] font-semibold uppercase"
            style={{ background: "rgba(217, 119, 6, 0.14)", color: v("accent"), letterSpacing: "0.12em" }}
          >
            {log.phase_name}
          </span>
        </div>

        <div className="px-3 pb-3 pt-1 text-[14px] leading-snug" style={{ color: v("ink") }}>
          {log.text ? (
            <p className="whitespace-pre-wrap">
              <span className="mr-1.5 font-semibold">{authorLabel}</span>
              {log.text}
            </p>
          ) : (
            <p style={{ color: v("muted") }}>
              {log.line_item_description || `Update from ${log.project_name}`}
            </p>
          )}
          {log.line_item_description && log.text && (
            <p className="mt-1 text-[11px]" style={{ color: v("quiet") }}>
              {log.line_item_description}
            </p>
          )}
        </div>
      </article>

      <ImageViewer
        url={previewUrl}
        urls={photos}
        filename={`${log.project_name} field photo`}
        onClose={() => setPreviewUrl(null)}
      />
    </>
  );
}
