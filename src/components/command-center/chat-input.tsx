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
      // Text stays in the input — user can review and edit before sending
    } else {
      setInput("");
      startListening();
    }
  };

  return (
    <div className="border-t bg-background p-4">
      <div className="flex items-end gap-3">
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
            "min-h-[48px] max-h-[120px] resize-none text-base rounded-xl px-4 py-3",
            isListening && "border-red-400 bg-red-50 dark:bg-red-950/20"
          )}
        />
        {isSupported && (
          <Button
            variant={isListening ? "destructive" : "outline"}
            size="icon"
            onClick={toggleVoice}
            disabled={disabled}
            className={cn(
              "shrink-0 h-12 w-12 rounded-xl",
              isListening && "animate-pulse"
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
