"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, Send, Loader2 } from "lucide-react";
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
      // Auto-send after stopping voice if there's content
      if (input.trim()) {
        setTimeout(() => {
          onSend(input.trim(), "voice");
          setInput("");
        }, 300);
      }
    } else {
      setInput("");
      startListening();
    }
  };

  return (
    <div className="border-t bg-background p-3">
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Ask me anything... (voice or text)"}
          disabled={disabled}
          rows={1}
          className={cn(
            "min-h-[44px] max-h-[120px] resize-none text-sm",
            isListening && "border-red-400 bg-red-50 dark:bg-red-950/20"
          )}
        />
        {isSupported && (
          <Button
            variant={isListening ? "destructive" : "outline"}
            size="icon"
            onClick={toggleVoice}
            disabled={disabled}
            className="shrink-0 h-[44px] w-[44px]"
          >
            {isListening ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
        )}
        <Button
          size="icon"
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className="shrink-0 h-[44px] w-[44px] bg-amber-600 hover:bg-amber-700"
        >
          {disabled ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
      {isListening && (
        <p className="text-xs text-red-500 mt-1 animate-pulse">
          Listening... speak now
        </p>
      )}
    </div>
  );
}
