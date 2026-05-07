"use client";

import { useEffect, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

/**
 * Reusable voice → AI-structured-notes button.
 *
 * Uses the browser's SpeechRecognition for live transcription, then sends
 * the transcript to /api/structure-notes which returns clean structured
 * text formatted for the caller's context (daily log, punch list, scope).
 *
 * Caller decides what to do with the result via onResult. If we detect
 * empty input or a hallucinated assistant greeting (which Claude will
 * sometimes emit when given near-empty input), onEmpty fires instead so
 * the caller can show a friendly "couldn't catch that" indicator rather
 * than pasting garbage into the textarea.
 */
export type VoiceToNotesContext = "daily-log" | "punch-list" | "scope";

const ASSISTANT_GREETING_PATTERNS = [
  /^hi[.!,]?\s+i['’]?m\b/i,
  /^hello[.!,]?\s+i['’]?m\b/i,
  /^i['’]?m ready to help/i,
  /^sure[,!.]\s+here['’]?s\b/i,
  /^here['’]?s your\b/i,
  /tell me what happened/i,
  /go ahead and tell me/i,
];

function looksLikeAssistantGreeting(text: string): boolean {
  return ASSISTANT_GREETING_PATTERNS.some((re) => re.test(text.trim()));
}

export function VoiceToNotes({
  context,
  onResult,
  onEmpty,
  className,
  label,
}: {
  context: VoiceToNotesContext;
  onResult: (cleaned: string) => void;
  onEmpty?: () => void;
  className?: string;
  label?: string;
}) {
  const { isListening, transcript, startListening, stopListening, isSupported } = useSpeechRecognition();
  const [structuring, setStructuring] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [emptyFlash, setEmptyFlash] = useState(false);

  // When the user stops, fire the AI-structuring call once.
  useEffect(() => {
    if (!isListening && lastTranscript === null && transcript.trim()) {
      const final = transcript.trim();
      setLastTranscript(final);
      setStructuring(true);
      fetch("/api/structure-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: final, context }),
      })
        .then((r) => r.json())
        .then((data) => {
          const cleaned = typeof data.cleaned === "string" ? data.cleaned.trim() : "";
          // Either the server flagged it empty, or Claude returned a
          // hallucinated assistant-greeting despite our system prompt.
          if (data.empty || !cleaned || looksLikeAssistantGreeting(cleaned)) {
            setEmptyFlash(true);
            setTimeout(() => setEmptyFlash(false), 2500);
            onEmpty?.();
            return;
          }
          onResult(cleaned);
        })
        .catch(() => {
          // Fall back to raw transcript so the user doesn't lose work.
          onResult(final);
        })
        .finally(() => {
          setStructuring(false);
          setLastTranscript(null);
        });
    }
  }, [isListening, transcript, lastTranscript, context, onResult, onEmpty]);

  if (!isSupported) {
    return (
      <button
        type="button"
        disabled
        className={className ?? "px-3 py-2 rounded-md text-xs opacity-50 cursor-not-allowed"}
      >
        Voice not supported
      </button>
    );
  }

  const busy = structuring;
  const active = isListening;

  return (
    <button
      type="button"
      onClick={active ? stopListening : busy ? undefined : startListening}
      disabled={busy}
      className={
        className ??
        `inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition ${
          emptyFlash
            ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
            : active
              ? "bg-red-500/15 text-red-400 border border-red-500/40"
              : busy
                ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
                : "bg-amber-500/15 text-amber-400 border border-amber-500/40 hover:bg-amber-500/25"
        }`
      }
      aria-pressed={active}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : active ? (
        <Square className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
      <span>
        {emptyFlash
          ? "Didn't catch that"
          : busy
            ? "Structuring…"
            : active
              ? "Stop"
              : (label ?? "Voice note")}
      </span>
    </button>
  );
}
