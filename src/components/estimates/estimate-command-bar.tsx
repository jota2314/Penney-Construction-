"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, Send, Undo2, Loader2 } from "lucide-react";

interface LineItemSnapshot {
  description: string;
  proposal_description: string;
  total_price: number;
  total_cost?: number;
  markup_percentage?: number;
}

interface HistoryEntry {
  lineItems: LineItemSnapshot[];
  command: string;
  summary: string;
}

interface EstimateCommandBarProps {
  currentLineItems: LineItemSnapshot[];
  projectContext?: {
    projectName?: string;
    projectType?: string;
  };
  onApplyEdit: (lineItems: LineItemSnapshot[]) => void;
  onUndo: () => void;
  canUndo: boolean;
  historyCount: number;
}

export function EstimateCommandBar({
  currentLineItems,
  projectContext,
  onApplyEdit,
  onUndo,
  canUndo,
  historyCount,
}: EstimateCommandBarProps) {
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track accumulated transcript across recognition restarts
  const transcriptRef = useRef("");
  const accumulatedRef = useRef("");

  const handleSubmit = useCallback(
    async (text?: string) => {
      const cmd = (text ?? command).trim();
      if (!cmd || loading) return;

      setLoading(true);
      setError(null);
      setLastSummary(null);

      try {
        const res = await fetch("/api/edit-estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: cmd,
            currentLineItems: currentLineItems.map((li) => ({
              description: li.description,
              proposal_description: li.proposal_description,
              total_price: li.total_price,
              total_cost: li.total_cost,
              markup_percentage: li.markup_percentage,
            })),
            projectContext,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to process command");
        }

        const { lineItems, changesSummary } = await res.json();

        if (!Array.isArray(lineItems) || lineItems.length === 0) {
          throw new Error("AI returned no line items");
        }

        onApplyEdit(lineItems);
        setLastSummary(changesSummary || "Estimate updated");
        setCommand("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to process command");
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [command, currentLineItems, projectContext, onApplyEdit, loading]
  );

  function handleVoiceToggle() {
    if (recording && recognitionRef.current) {
      // User stopped — kill recognition and auto-submit
      const ref = recognitionRef.current;
      recognitionRef.current = null; // prevent auto-restart in onend
      setRecording(false);
      ref.stop();
      // Auto-submit after a brief delay to let final results flush
      setTimeout(() => {
        setCommand((current) => {
          if (current.trim()) handleSubmit(current.trim());
          return current;
        });
      }, 400);
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
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    // Reset transcript accumulators for new recording session
    transcriptRef.current = "";
    accumulatedRef.current = "";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Rebuild from all results in this recognition session
      let sessionFinal = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          sessionFinal += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      // Combine accumulated text from previous sessions + current session
      const accumulated = accumulatedRef.current + sessionFinal;
      setCommand((accumulated + interim).trim());
      // Store session finals so when recognition restarts we keep them
      transcriptRef.current = sessionFinal;
    };

    recognition.onerror = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      // If ref is still set, user didn't manually stop — browser timed out
      // Save what we got so far and restart
      if (recognitionRef.current) {
        accumulatedRef.current += transcriptRef.current;
        transcriptRef.current = "";
        try {
          recognition.start();
          return;
        } catch {
          // ignore restart errors
        }
      }
      setRecording(false);
    };

    recognitionRef.current = recognition;
    setRecording(true);
    recognition.start();
  }

  return (
    <div className="border rounded-md bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Edit Estimate</h3>
        <div className="flex items-center gap-2">
          {canUndo && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onUndo}
              disabled={loading}
            >
              <Undo2 className="mr-1 h-3.5 w-3.5" />
              Undo ({historyCount})
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleVoiceToggle}
          disabled={loading}
          className={`shrink-0 p-2 rounded-md border transition-colors ${
            recording
              ? "bg-red-100 text-red-600 border-red-200 animate-pulse"
              : "hover:bg-muted text-muted-foreground hover:text-foreground border-transparent"
          } disabled:opacity-30`}
          title={recording ? "Listening..." : "Talk to edit"}
        >
          {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <form
          className="flex-1 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <Input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={
              recording
                ? "Listening..."
                : 'e.g. "bump framing to 15k" or "add landscaping for 3000"'
            }
            disabled={loading || recording}
            className="text-sm"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!command.trim() || loading}
            className="shrink-0"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </div>

      {lastSummary && (
        <p className="text-xs text-green-600">{lastSummary}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
