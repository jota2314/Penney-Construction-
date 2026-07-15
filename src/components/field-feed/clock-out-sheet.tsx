"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { v } from "./tokens";
import { clockOutWithLog } from "@/lib/actions/daily-logs";
import { compressImage } from "@/lib/image/compress";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

/** Upload one photo through our same-origin API (shrunk first), with a timeout. */
async function uploadPhoto(logId: string, file: File): Promise<boolean> {
  let body: Blob = file;
  try {
    body = await compressImage(file);
  } catch {
    // Couldn't decode/shrink (e.g. HEIC) — send the original and let the
    // server store it as-is.
  }
  const fd = new FormData();
  fd.append("logId", logId);
  fd.append("file", body, "photo.jpg");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch("/api/crew/daily-log-photo", {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function elapsed(startedIso: string | null): string {
  if (!startedIso) return "";
  const ms = Date.now() - new Date(startedIso).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function MicIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      {on ? (
        <>
          <rect x="7" y="3" width="6" height="10" rx="3" fill="currentColor" />
          <path d="M4 10c0 3.3 2.7 6 6 6s6-2.7 6-6" />
          <path d="M10 16v2" />
        </>
      ) : (
        <>
          <rect x="7" y="3" width="6" height="10" rx="3" />
          <path d="M4 10c0 3.3 2.7 6 6 6s6-2.7 6-6" />
          <path d="M10 16v2" />
        </>
      )}
    </svg>
  );
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
  const [files, setFiles] = useState<File[]>([]);
  const [pending, startTransition] = useTransition();
  const [enhancing, startEnhance] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Two separate inputs: the camera one carries `capture` (opens the camera
  // directly on mobile), the library one omits it so iOS/Android show the
  // photo library. A single `capture` input hides the library entirely.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  // Once the shift is clocked out we don't re-finalize on a photo retry.
  const [clockedOut, setClockedOut] = useState(false);
  // Photos still needing upload (set to the failures after a partial upload).
  const [toUpload, setToUpload] = useState<File[] | null>(null);

  const { isListening, transcript, startListening, stopListening, isSupported: speechSupported } = useSpeechRecognition();

  const previews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => {
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [previews]);

  const addFiles = (input: HTMLInputElement | null) => {
    if (!input?.files) return;
    const added = Array.from(input.files).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...added].slice(0, 8));
    // Reset the specific input that fired so re-picking the same file works.
    input.value = "";
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleMic = () => {
    if (isListening) {
      stopListening();
      const captured = transcript.trim();
      if (captured) {
        setText((prev) => (prev.trim() ? prev.trim() + " " : "") + captured);
      }
    } else {
      startListening();
    }
  };

  const enhance = () => {
    if (!text.trim()) return;
    setError(null);
    startEnhance(async () => {
      try {
        const res = await fetch("/api/clean-dictation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Enhance failed");
          return;
        }
        if (data.cleaned) setText(data.cleaned);
      } catch {
        setError("Enhance failed");
      }
    });
  };

  const canSubmit = text.trim().length > 0 && files.length > 0 && !pending && !enhancing && !isListening;

  const submit = () => {
    if (pending) return;
    if (!clockedOut && !canSubmit) return;
    setError(null);
    startTransition(async () => {
      // Clock out with the note FIRST so a slow photo upload can never block
      // posting. Only do this once — a photo retry re-enters here.
      if (!clockedOut) {
        const res = await clockOutWithLog(logId, text.trim(), []);
        if (res.error) {
          setError(res.error);
          return;
        }
        setClockedOut(true);
      }

      // Upload photos through our same-origin API (each shrunk first). Track
      // failures so they can be retried without re-posting the note.
      const queue = toUpload ?? files;
      const failed: File[] = [];
      for (const file of queue) {
        const ok = await uploadPhoto(logId, file);
        if (!ok) failed.push(file);
      }

      if (failed.length > 0) {
        setToUpload(failed);
        setError(
          `${failed.length} photo${failed.length > 1 ? "s" : ""} didn't upload. You're clocked out — tap Retry, or Skip to finish.`,
        );
        return;
      }
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92vh] overflow-hidden"
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
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>What did you get done?</span>
              <span className="text-[10px] uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>Required</span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Headers set, vapor barrier on west wall, rough framing complete…"
              rows={5}
              readOnly={isListening}
              className="w-full resize-none rounded-xl px-3 py-2.5 text-[14px] leading-snug outline-none"
              style={{
                background: v("bg-2"),
                color: v("ink"),
                border: `1px solid ${isListening ? "#10b981" : v("line")}`,
              }}
            />
            {isListening && (
              <div className="rounded-lg px-3 py-2 text-[13px] leading-snug" style={{ background: "rgba(16, 185, 129, 0.10)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.30)" }}>
                <span className="inline-flex items-center gap-1.5 mr-2 font-semibold uppercase text-[10px]" style={{ letterSpacing: "0.16em" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
                  Listening
                </span>
                {transcript || "Speak now…"}
              </div>
            )}
            <div className="flex items-center gap-2">
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleMic}
                  className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-[12px] font-semibold transition active:scale-[0.98]"
                  style={{
                    background: isListening ? "rgba(16, 185, 129, 0.18)" : v("bg-2"),
                    color: isListening ? "#34d399" : v("ink"),
                    border: `1px solid ${isListening ? "rgba(16, 185, 129, 0.45)" : v("line")}`,
                  }}
                >
                  <MicIcon on={isListening} />
                  {isListening ? "Stop" : "Talk"}
                </button>
              )}
              <button
                type="button"
                onClick={enhance}
                disabled={!text.trim() || enhancing || isListening}
                className="px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-[12px] font-semibold transition active:scale-[0.98] disabled:opacity-40"
                style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
              >
                <span>✨</span>
                {enhancing ? "Enhancing…" : "Enhance"}
              </button>
              <span className="ml-auto text-[10px]" style={{ color: v("quiet") }}>
                {text.trim().length} chars
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>Photos</span>
              <span className="text-[10px] uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>{files.length === 0 ? "Required" : `${files.length}/8`}</span>
            </div>

            {previews.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {previews.map((p, i) => (
                  <div key={p.url} className="relative aspect-square rounded-lg overflow-hidden" style={{ border: `1px solid ${v("line")}` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.7)", color: "#fff" }}
                      aria-label="Remove photo"
                    >
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                        <path d="M5 5l10 10M15 5L5 15" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {files.length < 8 && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="rounded-xl py-5 flex flex-col items-center justify-center gap-1.5"
                  style={{
                    background: v("bg-2"),
                    color: files.length === 0 ? "#fbbf24" : v("muted"),
                    border: `1px dashed ${files.length === 0 ? "rgba(217, 119, 6, 0.5)" : v("line")}`,
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                    <rect x="3" y="5" width="14" height="11" rx="1.5" />
                    <circle cx="10" cy="11" r="3" />
                    <path d="M7 5l1-2h4l1 2" />
                  </svg>
                  <span className="text-[13px] font-medium">Take photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => libraryInputRef.current?.click()}
                  className="rounded-xl py-5 flex flex-col items-center justify-center gap-1.5"
                  style={{
                    background: v("bg-2"),
                    color: files.length === 0 ? "#fbbf24" : v("muted"),
                    border: `1px dashed ${files.length === 0 ? "rgba(217, 119, 6, 0.5)" : v("line")}`,
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                    <rect x="3" y="4" width="14" height="12" rx="1.5" />
                    <circle cx="7" cy="8" r="1.5" />
                    <path d="M3 13l4-3 3 2 3-3 4 3" />
                  </svg>
                  <span className="text-[13px] font-medium">Photo library</span>
                </button>
              </div>
            )}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.currentTarget)}
            />
            <input
              ref={libraryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.currentTarget)}
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
            {clockedOut ? "Skip" : "Cancel"}
          </button>
          <button
            onClick={submit}
            disabled={pending || (!clockedOut && !canSubmit)}
            className="flex-1 py-3 rounded-xl text-[14px] font-semibold transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: v("accent"), color: "#1a0f00" }}
          >
            {pending
              ? clockedOut
                ? "Uploading…"
                : "Posting…"
              : clockedOut
                ? "Retry upload"
                : "Clock out + post"}
          </button>
        </div>
      </div>
    </div>
  );
}
