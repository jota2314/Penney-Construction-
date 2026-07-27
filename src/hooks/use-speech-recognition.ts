"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface UseSpeechRecognitionReturn {
  /** Mic is hot — stays true through the wind-down after the user taps stop. */
  isListening: boolean;
  /** User tapped stop; we're waiting on the recognizer's last words. */
  isFinalizing: boolean;
  transcript: string;
  /** Bumps on every startListening(). Callers use it to run post-stop work once. */
  sessionId: number;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
  /** A user-facing problem (mic blocked, no network). Null when fine. */
  error: string | null;
}

/** Android Chrome's Web Speech implementation is the one that misbehaves. */
const isAndroidUA = () =>
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

/**
 * How long to let an Android session endpoint on its own after the user taps
 * stop, before we force it closed. Long enough for the recognizer to deliver a
 * trailing sentence, short enough that the button doesn't feel stuck.
 */
const WIND_DOWN_MS = 1500;
/** Backstop if the recognizer never fires `onend` at all. */
const WIND_DOWN_HARD_MS = 1500;

/**
 * Cross-platform speech-to-text on top of the Web Speech API.
 *
 * The tricky part is Android Chrome, which misbehaves three ways:
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
 * 3. `stop()` DISCARDS the utterance still in flight instead of finalizing it,
 *    and its interim results are unreliable — so calling stop() the moment the
 *    user taps the button threw away everything they'd said since the last
 *    pause. Because (2) made every utterance its own session, that could be the
 *    whole dictation. On Android we now let the session endpoint naturally and
 *    only force it closed if it doesn't settle; `isListening` stays true until
 *    the recognizer is really done, so callers polish the COMPLETE transcript.
 * Real errors (mic blocked / no network) are surfaced instead of swallowed.
 */
export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sessionId, setSessionId] = useState(0);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const wantListeningRef = useRef(false); // user intends to keep listening
  const runningRef = useRef(false); // a recognition session is live right now
  const doneSessionsRef = useRef(""); // finalized text from completed sessions
  const sessionFinalRef = useRef(""); // finalized text within the current session
  const restartTimerRef = useRef<number | null>(null);
  const windDownTimerRef = useRef<number | null>(null);

  const clearWindDown = useCallback(() => {
    if (windDownTimerRef.current) {
      window.clearTimeout(windDownTimerRef.current);
      windDownTimerRef.current = null;
    }
  }, []);

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
    recognition.continuous = !isAndroidUA();
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      runningRef.current = true;
    };

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
        runningRef.current = false;
        clearWindDown();
        setError(
          "Microphone access is blocked. Allow microphone access for this site in your browser settings, then try again.",
        );
        setIsFinalizing(false);
        setIsListening(false);
      } else if (code === "network") {
        setError("Voice typing needs a connection — check your signal and try again.");
      }
      // "no-speech" / "aborted" are benign; onend will restart if still wanted.
    };

    recognition.onend = () => {
      runningRef.current = false;
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
        // The recognizer is truly done and its last words are banked. Only
        // now does the caller see isListening flip, so whatever it does with
        // the transcript sees the complete text.
        clearWindDown();
        setIsFinalizing(false);
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      wantListeningRef.current = false;
      runningRef.current = false;
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      if (windDownTimerRef.current) window.clearTimeout(windDownTimerRef.current);
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    };
  }, [clearWindDown]);

  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || wantListeningRef.current) return;
    clearWindDown();
    doneSessionsRef.current = "";
    sessionFinalRef.current = "";
    setTranscript("");
    setError(null);
    wantListeningRef.current = true;
    setIsFinalizing(false);
    setIsListening(true);
    setSessionId((n) => n + 1);
    try {
      recognition.start();
      // Mark the session live immediately rather than waiting for `onstart`,
      // which Android can delay by hundreds of ms. A stop tapped in that gap
      // would otherwise skip the teardown and leave the mic hot.
      runningRef.current = true;
    } catch {
      // start() throws InvalidStateError if a prior cycle is still ending;
      // onend will restart it. Leave runningRef alone — a prior session may
      // still be live.
    }
  }, [clearWindDown]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!wantListeningRef.current) return;
    wantListeningRef.current = false;
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    if (!recognition || !runningRef.current) {
      // Nothing in flight — we were between auto-restart sessions, so every
      // word is already banked. Finish immediately.
      clearWindDown();
      setIsFinalizing(false);
      setIsListening(false);
      return;
    }

    setIsFinalizing(true);

    if (!isAndroidUA()) {
      // iOS Safari / desktop Chrome finalize the pending utterance on stop().
      try {
        recognition.stop();
      } catch {
        runningRef.current = false;
        setIsFinalizing(false);
        setIsListening(false);
      }
      return;
    }

    // Android throws away the in-flight utterance on stop(). Give the
    // recognizer a moment to endpoint on its own and deliver those words;
    // force it closed only if it doesn't.
    windDownTimerRef.current = window.setTimeout(() => {
      windDownTimerRef.current = null;
      if (!runningRef.current) return; // onend already resolved us
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      // If onend never arrives, don't strand the UI mid-finalize.
      windDownTimerRef.current = window.setTimeout(() => {
        windDownTimerRef.current = null;
        runningRef.current = false;
        setIsFinalizing(false);
        setIsListening(false);
      }, WIND_DOWN_HARD_MS);
    }, WIND_DOWN_MS);
  }, [clearWindDown]);

  return {
    isListening,
    isFinalizing,
    transcript,
    sessionId,
    startListening,
    stopListening,
    isSupported,
    error,
  };
}
