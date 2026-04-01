"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Send, Loader2 } from "lucide-react";
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
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported,
  } = useSpeechRecognition();

  // When voice transcript updates, show it in the input (don't auto-send)
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
    }
  }, [transcript]);

  function handleSend() {
    const text = input.trim();
    if (!text || disabled) return;
    onSend(text);
    setInput("");
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
      // Text stays in the input — user can review and edit before sending
    } else {
      setInput("");
      startListening();
    }
  }

  return (
    <div className="border-t bg-background p-4">
      <div className="flex items-end gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isListening
              ? "Listening... tap mic to stop"
              : hasMessages
                ? "Reply to AI..."
                : "Ask AI anything..."
          }
          disabled={disabled}
          rows={1}
          className={`flex-1 min-h-[48px] max-h-[120px] resize-none rounded-xl border bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-500 ${
            isListening ? "border-red-400 bg-red-950/20" : ""
          }`}
        />
        {isSupported && (
          <button
            onClick={toggleVoice}
            disabled={disabled}
            className={`shrink-0 h-12 w-12 rounded-xl flex items-center justify-center transition-colors ${
              isListening
                ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
                : "border text-muted-foreground hover:text-amber-400 hover:border-amber-500/30"
            }`}
          >
            {isListening ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>
        )}
        <Button
          size="icon"
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className="shrink-0 h-12 w-12 rounded-xl bg-amber-600 hover:bg-amber-700"
        >
          {disabled ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </Button>
      </div>
      {isListening && (
        <p className="text-sm text-red-400 mt-2 animate-pulse text-center">
          Listening... tap mic to stop, then edit or send
        </p>
      )}
    </div>
  );
}
