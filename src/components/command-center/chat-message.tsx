"use client";

import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  source?: "text" | "voice";
  isStreaming?: boolean;
}

export function ChatMessage({ role, content, source, isStreaming }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex gap-3 py-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-amber-600 text-white" : "bg-zinc-800 text-amber-400"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-amber-600 text-white rounded-br-md"
            : "bg-zinc-100 dark:bg-zinc-800 text-foreground rounded-bl-md"
        )}
      >
        {source === "voice" && isUser && (
          <span className="text-xs opacity-70 block mb-1">Voice message</span>
        )}
        <div className="whitespace-pre-wrap">{content}</div>
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-amber-400 animate-pulse ml-0.5" />
        )}
      </div>
    </div>
  );
}
