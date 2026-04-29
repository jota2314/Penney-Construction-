"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { v } from "./tokens";
import { clockOutWithLog } from "@/lib/actions/daily-logs";
import { createClient } from "@/lib/supabase/client";

const PHOTO_BUCKET = "daily-log-photos";

function elapsed(startedIso: string | null): string {
  if (!startedIso) return "";
  const ms = Date.now() - new Date(startedIso).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function ClockOutSheet({
  logId,
  phaseLabel,
  startedAt,
  onClose,
}: {
  logId: string;
  phaseLabel: string;
  startedAt: string | null;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const photoPaths: string[] = [];
      if (file) {
        const supabase = createClient();
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${logId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) {
          setError(`Upload failed: ${upErr.message}`);
          return;
        }
        photoPaths.push(path);
      }
      const res = await clockOutWithLog(logId, text.trim(), photoPaths);
      if (res.error) {
        setError(res.error);
        return;
      }
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90vh] overflow-hidden"
        style={{ background: v("card"), border: `1px solid ${v("line")}`, color: v("ink") }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${v("line")}` }}>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>Clock out</div>
            <div className="text-[15px] font-semibold leading-tight mt-0.5 truncate" style={{ color: v("ink") }}>{phaseLabel}</div>
            {startedAt && (
              <div className="text-[12px]" style={{ color: v("muted") }}>
                Started {new Date(startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · {elapsed(startedAt)}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="opacity-60 hover:opacity-100 flex-shrink-0 ml-3" style={{ color: v("ink") }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>What did you get done?</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Headers set, vapor barrier on west wall, rough framing complete…"
              rows={4}
              className="w-full resize-none rounded-xl px-3 py-2.5 text-[14px] leading-snug outline-none"
              style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>Photo (optional)</span>
            {preview ? (
              <div className="relative rounded-xl overflow-hidden" style={{ border: `1px solid ${v("line")}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Preview" className="w-full max-h-64 object-cover" />
                <button
                  onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  className="absolute top-2 right-2 px-2 py-1 rounded text-[11px] font-semibold"
                  style={{ background: "rgba(0,0,0,0.7)", color: "#fff" }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl py-6 flex flex-col items-center justify-center gap-2"
                style={{ background: v("bg-2"), color: v("muted"), border: `1px dashed ${v("line")}` }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                  <rect x="3" y="5" width="14" height="11" rx="1.5" />
                  <circle cx="10" cy="11" r="3" />
                  <path d="M7 5l1-2h4l1 2" />
                </svg>
                <span className="text-[13px]">Add a photo</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {error && (
            <div className="text-[13px] px-3 py-2 rounded-lg" style={{ background: "rgba(239, 68, 68, 0.14)", color: "#fca5a5", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 flex gap-2" style={{ borderTop: `1px solid ${v("line")}` }}>
          <button
            onClick={onClose}
            disabled={pending}
            className="flex-1 py-3 rounded-xl text-[14px] font-medium transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: "transparent", color: v("muted"), border: `1px solid ${v("line")}` }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={pending}
            className="flex-1 py-3 rounded-xl text-[14px] font-semibold transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: v("accent"), color: "#1a0f00" }}
          >
            {pending ? "Posting…" : "Clock out + post"}
          </button>
        </div>
      </div>
    </div>
  );
}
