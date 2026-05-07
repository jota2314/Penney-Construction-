"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, Send, Loader2, Sparkles } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { cn } from "@/lib/utils";
import { ChatAttachments, type ChatAttachment } from "@/components/chat/chat-attachments";

interface ChatInputProps {
  onSend: (message: string, source: "text" | "voice", attachments?: ChatAttachment[]) => void;
  disabled?: boolean;
  placeholder?: string;
  projectId?: string;
}

export function ChatInput({ onSend, disabled, placeholder, projectId }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
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
    if ((!text && attachments.length === 0) || disabled) return;
    onSend(text || "(attached files)", isListening ? "voice" : "text", attachments.length > 0 ? attachments : undefined);
    setInput("");
    setAttachments([]);
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
    } else {
      setInput("");
      startListening();
    }
  };

  return (
    <div className="border-t bg-background/80 backdrop-blur-sm px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom,1rem))]">
      {/* Magic writing shimmer line */}
      {isListening && (
        <div className="h-0.5 mb-3 rounded-full bg-gradient-to-r from-transparent via-amber-500 to-transparent animate-shimmer overflow-hidden" />
      )}

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="mb-2">
          <ChatAttachments
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            projectId={projectId}
            disabled={disabled}
          />
        </div>
      )}

      <div className="flex items-end gap-3 max-w-full">
        {/* Attach button */}
        {attachments.length === 0 && (
          <ChatAttachments
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            projectId={projectId}
            disabled={disabled}
          />
        )}

        {/* min-w-0 lets the textarea wrapper shrink below its content
            width — without it, a pasted-in long line forces horizontal
            overflow and pushes the mic/send buttons off-screen. */}
        <div className="relative flex-1 min-w-0">
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
            // Explicit 16px to stop iOS Safari auto-zooming the
            // viewport when the input gains focus. Tailwind text-base
            // is also 16px but iOS sometimes ignores class-based size
            // — inline style is the only reliable lever.
            style={{ fontSize: "16px" }}
            className={cn(
              "min-h-[48px] max-h-[120px] w-full resize-none rounded-xl py-3",
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
          disabled={disabled || (!input.trim() && attachments.length === 0)}
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
