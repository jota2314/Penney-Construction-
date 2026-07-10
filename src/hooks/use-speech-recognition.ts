"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
  /** A user-facing problem (mic blocked, no network). Null when fine. */
  error: string | null;
}

/**
 * Cross-platform speech-to-text on top of the Web Speech API.
 *
 * The tricky part is Android Chrome, which misbehaves two ways:
 * 1. Even with `continuous = true` it stops recognition after every pause and
 *    fires `onend`, where iOS Safari keeps the session open. We auto-restart
 *    while the user still wants to listen.
 * 2. Its continuous mode re-delivers results it already finalized (the event's
 *    `resultIndex` doesn't advance reliably), so any `+=` accumulator doubles
 *    the dictated words. We avoid it by (a) not using continuous mode on
 *    Android — each utterance is its own short session, the auto-restart keeps
 *    the mic hot between them — and (b) rebuilding the current session's text
 *    from the full result list on every event, which is idempotent even if an
 *    event is re-fired.
 * Real errors (mic blocked / no network) are surfaced instead of swallowed.
 */
export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const wantListeningRef = useRef(false); // user intends to keep listening
  const doneSessionsRef = useRef(""); // finalized text from completed sessions
  const sessionFinalRef = useRef(""); // finalized text within the current session
  const restartTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const SpeechRecognitionAPI =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

    // Capability detection has to run after mount (no window during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSupported(!!SpeechRecognitionAPI);
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    // Android's continuous mode re-delivers already-final results (doubled
    // words). Short non-continuous sessions + the onend auto-restart give the
    // same hands-free flow without the duplication.
    const isAndroid = /android/i.test(navigator.userAgent);
    recognition.continuous = !isAndroid;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Rebuild the current session's text from the full result list every
      // event (never append increments) — a re-fired event then produces the
      // same string instead of doubled words.
      let sessionFinal = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          sessionFinal += text + " ";
        } else {
          interim += text;
        }
      }
      sessionFinalRef.current = sessionFinal;
      setTranscript((doneSessionsRef.current + sessionFinal + interim).trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event?.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        // Permission denied — stop trying and tell the user.
        wantListeningRef.current = false;
        setError(
          "Microphone access is blocked. Allow microphone access for this site in your browser settings, then try again.",
        );
        setIsListening(false);
      } else if (code === "network") {
        setError("Voice typing needs a connection — check your signal and try again.");
      }
      // "no-speech" / "aborted" are benign; onend will restart if still wanted.
    };

    recognition.onend = () => {
      // Bank this session's finalized text — the next session's result list
      // starts from scratch.
      doneSessionsRef.current += sessionFinalRef.current;
      sessionFinalRef.current = "";
      // Android ends recognition after each pause. If the user hasn't tapped
      // stop, restart so dictation keeps going.
      if (wantListeningRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          try {
            recognition.start();
          } catch {
            // Already started / mid-cycle — ignore.
          }
        }, 250);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      wantListeningRef.current = false;
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    };
  }, []);

  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || wantListeningRef.current) return;
    doneSessionsRef.current = "";
    sessionFinalRef.current = "";
    setTranscript("");
    setError(null);
    wantListeningRef.current = true;
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      // start() throws InvalidStateError if a prior cycle is still ending;
      // onend will restart it.
    }
  }, []);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    wantListeningRef.current = false;
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    setIsListening(false);
    try {
      recognition?.stop();
    } catch {
      // ignore
    }
  }, []);

  return { isListening, transcript, startListening, stopListening, isSupported, error };
}
