"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, Send, Loader2, Sparkles } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string, source: "text" | "voice") => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isListening, transcript, startListening, stopListening, isSupported } =
    useSpeechRecognition();

  // When voice transcript updates, show it in the input
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
    }
  }, [transcript]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || disabled) return;
    onSend(text, isListening ? "voice" : "text");
    setInput("");
    stopListening();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleVoice = () => {
    if (isListening) {
      stopListening();
      // Text stays in the input — user can review and edit before sending
    } else {
      setInput("");
      startListening();
    }
  };

  return (
    <div className="border-t bg-background/80 backdrop-blur-sm p-4">
      {/* Magic writing shimmer line */}
      {isListening && (
        <div className="h-0.5 mb-3 rounded-full bg-gradient-to-r from-transparent via-amber-500 to-transparent animate-shimmer overflow-hidden" />
      )}
      <div className="flex items-end gap-3">
        <div className="relative flex-1">
          {!input && !isListening && (
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-500/40 pointer-events-none" />
          )}
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isListening
                ? "Listening... tap mic to stop"
                : placeholder || "Ask me anything..."
            }
            disabled={disabled}
            rows={1}
            className={cn(
              "min-h-[48px] max-h-[120px] resize-none text-base rounded-xl py-3",
              !input && !isListening ? "pl-9 pr-4" : "px-4",
              isListening && "border-amber-500/50 bg-amber-500/5 shadow-[0_0_12px_rgba(217,119,6,0.15)]"
            )}
          />
        </div>
        {isSupported && (
          <Button
            variant={isListening ? "default" : "outline"}
            size="icon"
            onClick={toggleVoice}
            disabled={disabled}
            className={cn(
              "shrink-0 h-12 w-12 rounded-xl transition-all",
              isListening
                ? "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 animate-pulse"
                : "hover:border-amber-500/50 hover:text-amber-500"
            )}
          >
            {isListening ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </Button>
        )}
        <Button
          size="icon"
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className="shrink-0 h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 hover:from-amber-600 hover:to-amber-800 shadow-lg shadow-amber-600/30"
        >
          {disabled ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </Button>
      </div>
      {isListening && (
        <p className="text-xs text-amber-500/70 mt-2 text-center">
          Listening... tap mic to stop, then edit or send
        </p>
      )}
    </div>
  );
}
