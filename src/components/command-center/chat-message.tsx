"use client";

import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";
import { Fragment, type ReactNode } from "react";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  source?: "text" | "voice";
  isStreaming?: boolean;
}

// Minimal inline markdown renderer — handles [label](url), **bold**,
// and preserves line breaks. Enough for the AI's common outputs
// (clickable file links, emphasized labels) without pulling in a full
// markdown library.
function renderInlineMarkdown(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  // Pattern matches [label](url) OR **bold**
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(<Fragment key={key++}>{text.slice(lastIndex, m.index)}</Fragment>);
    }
    if (m[1] && m[2]) {
      // Markdown link
      nodes.push(
        <a
          key={key++}
          href={m[2]}
          target="_blank"
          rel="noreferrer"
          className="text-amber-600 dark:text-amber-400 underline underline-offset-2 hover:text-amber-500 break-all"
        >
          {m[1]}
        </a>
      );
    } else if (m[3]) {
      nodes.push(<strong key={key++}>{m[3]}</strong>);
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
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
        <div className="whitespace-pre-wrap">
          {isUser ? content : renderInlineMarkdown(content)}
        </div>
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-amber-400 animate-pulse ml-0.5" />
        )}
      </div>
    </div>
  );
}
