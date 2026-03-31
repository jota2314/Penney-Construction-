"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Send } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

interface TodoChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  hasMessages?: boolean;
}

export function TodoChatInput({
  onSend,
  disabled,
  hasMessages,
}: TodoChatInputProps) {
  const [input, setInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported,
  } = useSpeechRecognition();

  // When voice transcript updates, capture it
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
    }
  }, [transcript]);

  // When we stop listening and have text, show it for review
  useEffect(() => {
    if (!isListening && input.trim() && !showTextInput) {
      setShowTextInput(true);
      // Auto-send after a short delay
      const timer = setTimeout(() => {
        if (input.trim()) {
          onSend(input.trim());
          setInput("");
          setShowTextInput(false);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isListening]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSend() {
    const text = input.trim();
    if (!text || disabled) return;
    onSend(text);
    setInput("");
    setShowTextInput(false);
    stopListening();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function toggleVoice() {
    if (isListening) {
      stopListening();
    } else {
      setInput("");
      setShowTextInput(false);
      startListening();
    }
  }

  // Listening mode — big pulsing mic, no text input
  if (isListening) {
    return (
      <div className="border-t bg-background p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            {/* Pulse rings */}
            <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />
            <div className="absolute -inset-2 rounded-full bg-amber-500/10 animate-pulse" />
            <button
              onClick={toggleVoice}
              className="relative h-16 w-16 rounded-full bg-amber-600 hover:bg-amber-700 flex items-center justify-center text-white shadow-lg shadow-amber-600/30 transition-colors"
            >
              <MicOff className="h-7 w-7" />
            </button>
          </div>
          <p className="text-sm text-amber-400 animate-pulse">
            Listening... tap to stop
          </p>
          {transcript && (
            <p className="text-xs text-muted-foreground text-center max-w-sm">
              {transcript}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Has text to review/send or text input is active
  if (showTextInput || input || hasMessages) {
    return (
      <div className="border-t bg-background p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              hasMessages
                ? "Reply to AI... (or tap mic)"
                : "Ask AI anything..."
            }
            disabled={disabled}
            rows={1}
            className="flex-1 min-h-[44px] max-h-[120px] resize-none rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          {isSupported && (
            <button
              onClick={toggleVoice}
              disabled={disabled}
              className="shrink-0 h-[44px] w-[44px] rounded-lg border flex items-center justify-center text-muted-foreground hover:text-amber-400 hover:border-amber-500/30 transition-colors"
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
          <Button
            size="icon"
            onClick={handleSend}
            disabled={disabled || !input.trim()}
            className="shrink-0 h-[44px] w-[44px] bg-amber-600 hover:bg-amber-700"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Default: big centered mic button — voice first
  return (
    <div className="border-t bg-background p-4">
      <div className="flex items-center gap-3">
        {isSupported && (
          <button
            onClick={toggleVoice}
            disabled={disabled}
            className="shrink-0 h-14 w-14 rounded-full bg-amber-600 hover:bg-amber-700 flex items-center justify-center text-white shadow-lg shadow-amber-600/30 transition-colors mx-auto"
          >
            <Mic className="h-6 w-6" />
          </button>
        )}
      </div>
      <button
        onClick={() => setShowTextInput(true)}
        className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground text-center transition-colors"
      >
        or type a message
      </button>
    </div>
  );
}
