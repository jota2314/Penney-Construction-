"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, MapPin, AlertTriangle, Loader2 } from "lucide-react";
import { v } from "./tokens";
import type { FeedPunchItem } from "@/lib/actions/daily-logs";
import { markPunchItemDone } from "@/lib/actions/punch-list";
import { createClient } from "@/lib/supabase/client";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diff < 86400 * 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function colorFromId(id: string): string {
  const palette = ["#D97706", "#0E7490", "#7C3AED", "#DC2626", "#059669", "#0891B2", "#B45309", "#0F766E"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function initials(name: string | null, email: string | null): string {
  const src = name?.trim() || email?.split("@")[0] || "?";
  const parts = src.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const PRIORITY_TONE: Record<string, { bg: string; border: string; text: string }> = {
  high: { bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.4)", text: "#fca5a5" },
  urgent: { bg: "rgba(239, 68, 68, 0.18)", border: "rgba(239, 68, 68, 0.5)", text: "#fca5a5" },
  medium: { bg: "rgba(217, 119, 6, 0.14)", border: "rgba(217, 119, 6, 0.4)", text: "#fbbf24" },
  low: { bg: "rgba(100, 116, 139, 0.18)", border: "rgba(100, 116, 139, 0.4)", text: "#94a3b8" },
};

export function PunchListPost({ item }: { item: FeedPunchItem }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [completing, setCompleting] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isCompleted = item.variant === "completed" || item.status === "done";
  const tone = PRIORITY_TONE[item.priority] ?? PRIORITY_TONE.medium;
  const photos = item.photo_signed_urls;
  const authorLabel = item.author_name?.trim() || item.author_email?.split("@")[0] || "Someone";
  const avatarBg = colorFromId(item.author_id || item.id);
  const avatarInit = initials(item.author_name, item.author_email);

  const onMarkDone = async (completionFile?: File) => {
    if (!item.project_id) return;
    setCompleting(true);
    setError(null);
    try {
      let completionPath: string | null = null;
      if (completionFile) {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError("Sign in to complete.");
          setCompleting(false);
          return;
        }
        const ext = completionFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${item.project_id}/punch-list/done-${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("project-files")
          .upload(path, completionFile, { contentType: completionFile.type, upsert: false });
        if (upErr) {
          setError(`Upload failed: ${upErr.message}`);
          setCompleting(false);
          return;
        }
        completionPath = path;
      }
      const result = await markPunchItemDone(item.id, item.project_id, completionPath);
      if (result.error) setError(result.error);
      else router.refresh();
    } finally {
      setCompleting(false);
    }
  };

  const onPhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onMarkDone(file);
    e.target.value = "";
  };

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: v("card"),
        border: `1px solid ${isCompleted ? "rgba(52, 211, 153, 0.30)" : tone.border}`,
      }}
    >
      <div className="px-4 pt-3 pb-1 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center font-semibold flex-shrink-0 text-white"
          style={{ background: avatarBg, fontSize: 11, letterSpacing: "0.04em" }}
        >
          {avatarInit}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={
                isCompleted
                  ? { background: "rgba(52, 211, 153, 0.15)", color: "#34d399" }
                  : { background: tone.bg, color: tone.text }
              }
            >
              {isCompleted ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
              {isCompleted ? "Punch · Done" : "Punch"}
            </span>
            {item.priority === "high" || item.priority === "urgent" ? (
              <span className="text-[10px] font-medium uppercase" style={{ color: "#fca5a5", letterSpacing: "0.14em" }}>
                {item.priority}
              </span>
            ) : null}
          </div>
          <div className="text-[14px] font-semibold leading-tight mt-0.5" style={{ color: v("ink") }}>
            {authorLabel}
            <span className="font-normal opacity-70"> · {fmtTime(item.created_at)}</span>
          </div>
          <div className="text-[11px] font-mono truncate" style={{ color: v("quiet"), letterSpacing: "0.05em" }}>
            {item.project_name}
            {item.location ? ` · ${item.location}` : ""}
          </div>
        </div>
      </div>

      <div className="px-4 pt-2 pb-3 text-[15px] leading-snug whitespace-pre-wrap" style={{ color: v("ink") }}>
        {item.location && (
          <span
            className="inline-flex items-center gap-1 mr-1.5 align-middle rounded px-1.5 py-0.5 text-[10px] uppercase font-semibold"
            style={{ background: tone.bg, color: tone.text, letterSpacing: "0.08em" }}
          >
            <MapPin className="h-2.5 w-2.5" />
            {item.location}
          </span>
        )}
        {item.description}
      </div>

      {photos.length > 0 && !isCompleted && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[photoIdx]}
            alt="Issue"
            className="w-full aspect-[4/3] object-cover"
            style={{ background: v("bg-2") }}
          />
          {photos.length > 1 && (
            <>
              <button
                onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
              >‹</button>
              <button
                onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
              >›</button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {photos.map((_, i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full"
                    style={{ background: i === photoIdx ? "#fff" : "rgba(255,255,255,0.4)" }} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {isCompleted && item.completion_photo_url && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.completion_photo_url}
            alt="Completion"
            className="w-full aspect-[4/3] object-cover"
            style={{ background: v("bg-2") }}
          />
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
            <CheckCircle2 className="h-3 w-3" />
            After
          </span>
        </div>
      )}

      <div className="px-3 pt-2 pb-3 flex items-center gap-2" style={{ borderTop: `1px solid ${v("line-soft")}` }}>
        {item.assignee && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("muted") }}>
            → {item.assignee}
          </span>
        )}
        {!isCompleted ? (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={completing}
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            >
              {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              {completing ? "Saving…" : "Mark done with photo"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onPhotoSelected}
              className="hidden"
            />
          </>
        ) : (
          <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
            Closed
          </span>
        )}
      </div>

      {error && (
        <div className="px-3 pb-3 text-xs text-red-400">{error}</div>
      )}
    </div>
  );
}
