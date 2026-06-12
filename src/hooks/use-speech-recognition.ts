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
 * The tricky part is Android Chrome: even with `continuous = true` it stops
 * recognition after every pause and fires `onend`, where iOS Safari keeps the
 * session open. The old version just flipped `isListening` off on `onend`, so on
 * Android dictation died the instant you paused and never resumed. Here we
 * auto-restart while the user still wants to listen, accumulate the finalized
 * text across those restarts, and surface real errors (mic blocked / no
 * network) instead of swallowing them.
 */
export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const wantListeningRef = useRef(false); // user intends to keep listening
  const finalRef = useRef(""); // finalized text accumulated across restarts
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
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      // Only walk the new results (resultIndex onward) so finals aren't
      // double-counted; this also works after an Android auto-restart.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalRef.current += text + " ";
        } else {
          interim += text;
        }
      }
      setTranscript((finalRef.current + interim).trim());
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
    finalRef.current = "";
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
