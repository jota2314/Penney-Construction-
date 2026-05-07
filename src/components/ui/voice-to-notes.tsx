"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

/**
 * Reusable voice → AI-structured-notes button.
 *
 * Two modes:
 *  - Default: silent recording. User taps mic, talks, taps stop. We send
 *    the final transcript to /api/structure-notes and call onResult with
 *    the AI-polished version.
 *  - Live mode (onLiveTranscript provided): the transcript is piped to
 *    the caller in real time AS the user speaks, so they can see words
 *    appearing in their textarea. Final polish happens on stop.
 *
 * Polishing is suppressed if the transcript is empty / under 3 words /
 * matches a hallucinated assistant-greeting pattern. In those cases we
 * call onEmpty (or do nothing) instead of pasting garbage.
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
  onLiveTranscript,
  onEmpty,
  className,
  label,
}: {
  context: VoiceToNotesContext;
  onResult: (cleaned: string) => void;
  onLiveTranscript?: (live: string, isFinal: boolean) => void;
  onEmpty?: () => void;
  className?: string;
  label?: string;
}) {
  const { isListening, transcript, startListening, stopListening, isSupported } = useSpeechRecognition();
  const [structuring, setStructuring] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [emptyFlash, setEmptyFlash] = useState(false);

  // Stream live transcript to caller while listening so they can mirror
  // the words into a textarea (chat-style live editing experience).
  useEffect(() => {
    if (!onLiveTranscript) return;
    if (isListening) {
      onLiveTranscript(transcript, false);
    }
  }, [isListening, transcript, onLiveTranscript]);

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
          if (data.empty || !cleaned || looksLikeAssistantGreeting(cleaned)) {
            setEmptyFlash(true);
            setTimeout(() => setEmptyFlash(false), 2500);
            // Tell the caller to revert any live-transcript chunk it
            // already mirrored, since AI says it had no real content.
            onLiveTranscript?.("", true);
            onEmpty?.();
            return;
          }
          onResult(cleaned);
          // Signal the caller that we've now committed the polished
          // version, so it can stop showing the raw live transcript.
          onLiveTranscript?.(cleaned, true);
        })
        .catch(() => {
          onResult(final);
          onLiveTranscript?.(final, true);
        })
        .finally(() => {
          setStructuring(false);
          setLastTranscript(null);
        });
    }
  }, [isListening, transcript, lastTranscript, context, onResult, onEmpty, onLiveTranscript]);

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
        `inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition active:scale-[0.98] ${
          emptyFlash
            ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
            : active
              ? "bg-red-500 hover:bg-red-600 text-white border border-red-500 shadow-lg shadow-red-500/30 animate-pulse"
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
            ? "Polishing…"
            : active
              ? "Stop"
              : (label ?? "Voice note")}
      </span>
    </button>
  );
}

/**
 * Helper hook for textareas that want the chat-style live-mirror
 * experience. Manages the snapshot/polish swap so callers don't have
 * to. Returns the value to render and the handlers to wire into mic
 * + textarea.
 */
export function useLiveVoiceTextarea(value: string, setValue: (v: string) => void) {
  const snapshotBeforeRecord = useRef<string>("");
  const [liveAppend, setLiveAppend] = useState<string>("");
  const [recording, setRecording] = useState(false);

  const startRecording = () => {
    snapshotBeforeRecord.current = value;
    setLiveAppend("");
    setRecording(true);
  };

  const onLive = (live: string, isFinal: boolean) => {
    if (isFinal) {
      // Final polished version arrives through onResult; here we only
      // need to clear the live overlay.
      setLiveAppend("");
      setRecording(false);
      return;
    }
    setLiveAppend(live);
  };

  const onResult = (cleaned: string) => {
    const head = snapshotBeforeRecord.current.trim();
    const merged = head ? `${head}\n\n${cleaned}` : cleaned;
    setValue(merged);
  };

  const display = recording && liveAppend
    ? (snapshotBeforeRecord.current.trim()
        ? `${snapshotBeforeRecord.current.trim()}\n\n${liveAppend}`
        : liveAppend)
    : value;

  return { display, recording, startRecording, onLive, onResult };
}
