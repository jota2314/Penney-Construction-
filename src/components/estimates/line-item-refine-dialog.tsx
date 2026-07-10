"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, Loader2, Check, X } from "lucide-react";

interface LineItemRefineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  scope: string;
  price: number;
  projectType?: string;
  projectAddress?: string;
  onApply: (updated: { itemName: string; scope: string; price: number }) => void;
}

export function LineItemRefineDialog({
  open,
  onOpenChange,
  itemName,
  scope,
  price,
  projectType,
  projectAddress,
  onApply,
}: LineItemRefineDialogProps) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    itemName: string;
    scope: string;
    price: number;
  } | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  function resetState() {
    setTranscript("");
    setProcessing(false);
    setError(null);
    setResult(null);
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setRecording(false);
    }
  }

  function handleOpenChange(value: boolean) {
    if (!value) resetState();
    onOpenChange(value);
  }

  function handleVoiceToggle() {
    if (recording && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setRecording(false);
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    // Android re-delivers already-final results in continuous mode (doubled
    // words); single-utterance sessions avoid it — Android ends recognition
    // after each pause either way.
    recognition.continuous = !/android/i.test(navigator.userAgent);
    recognition.interimResults = false;
    recognition.lang = "en-US";

    // Rebuild finals from the full result list every event and append only the
    // unseen tail — Android re-fires events with already-final results.
    let committed = "";
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let spoken = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          spoken += (spoken ? " " : "") + event.results[i][0].transcript.trim();
        }
      }
      if (spoken.length <= committed.length) return;
      const text = spoken.slice(committed.length).trim();
      committed = spoken;
      if (text) {
        setTranscript((prev) => {
          const separator = prev.trim() ? " " : "";
          return prev + separator + text;
        });
      }
    };

    recognition.onerror = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setRecording(true);
    recognition.start();
  }

  async function handleSend() {
    if (!transcript.trim()) return;

    // Stop recording if active
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setRecording(false);
    }

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/refine-line-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemName,
          scope,
          price,
          instruction: transcript.trim(),
          projectType,
          projectAddress,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to refine");
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refine");
    } finally {
      setProcessing(false);
    }
  }

  function handleAccept() {
    if (!result) return;
    onApply(result);
    handleOpenChange(false);
  }

  function handleTryAgain() {
    setResult(null);
    setTranscript("");
  }

  const nameChanged = result && result.itemName !== itemName;
  const scopeChanged = result && result.scope !== scope;
  const priceChanged = result && result.price !== price;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Refine: {itemName || "Line Item"}
          </DialogTitle>
        </DialogHeader>

        {/* Current item summary */}
        <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
          <div>
            <span className="text-muted-foreground">Item:</span>{" "}
            <span className="font-medium">{itemName || "(empty)"}</span>
          </div>
          {scope && (
            <div>
              <span className="text-muted-foreground">Scope:</span>
              <p className="whitespace-pre-wrap text-xs mt-0.5">{scope}</p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Price:</span>{" "}
            <span className="font-medium">
              ${price ? price.toLocaleString() : "0"}
            </span>
          </div>
        </div>

        {/* Result preview */}
        {result && (
          <div className="rounded-md border-2 border-primary/30 bg-primary/5 p-3 space-y-1.5 text-sm">
            <p className="text-xs font-semibold text-primary mb-2">
              Proposed Changes:
            </p>
            {nameChanged && (
              <div>
                <span className="text-muted-foreground">Item:</span>{" "}
                <span className="font-medium text-primary">
                  {result.itemName}
                </span>
              </div>
            )}
            {scopeChanged && (
              <div>
                <span className="text-muted-foreground">Scope:</span>
                <p className="whitespace-pre-wrap text-xs mt-0.5 text-primary">
                  {result.scope}
                </p>
              </div>
            )}
            {priceChanged && (
              <div>
                <span className="text-muted-foreground">Price:</span>{" "}
                <span className="font-medium text-primary">
                  ${result.price.toLocaleString()}
                </span>
              </div>
            )}
            {!nameChanged && !scopeChanged && !priceChanged && (
              <p className="text-muted-foreground text-xs">
                No changes detected. Try a different instruction.
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleAccept}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Apply
              </Button>
              <Button size="sm" variant="outline" onClick={handleTryAgain}>
                <X className="mr-1.5 h-3.5 w-3.5" />
                Try Again
              </Button>
            </div>
          </div>
        )}

        {/* Voice input area */}
        {!result && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Tell me what to change — rename it, adjust the scope, set a price.
            </p>

            {/* Big mic button */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleVoiceToggle}
                disabled={processing}
                className={`p-6 rounded-full transition-all ${
                  recording
                    ? "bg-red-100 text-red-600 hover:bg-red-200 animate-pulse scale-110"
                    : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                } disabled:opacity-30 disabled:pointer-events-none`}
              >
                {recording ? (
                  <MicOff className="h-8 w-8" />
                ) : (
                  <Mic className="h-8 w-8" />
                )}
              </button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {recording
                ? "Listening... tap to stop"
                : "Tap the mic and start talking"}
            </p>

            {/* Transcript / text input */}
            <div className="flex gap-2">
              <Input
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Or type your instruction here..."
                className="text-sm"
                disabled={processing}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && transcript.trim()) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button
                onClick={handleSend}
                disabled={!transcript.trim() || processing}
                size="sm"
              >
                {processing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
