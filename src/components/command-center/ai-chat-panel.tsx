"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Bot, Mic, Trash2, Plus } from "lucide-react";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "text" | "voice";
}

interface AIChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  projectName?: string;
  initialMessage?: string;
}

export function AIChatPanel({
  open,
  onOpenChange,
  projectId,
  projectName,
  initialMessage,
}: AIChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialSentRef = useRef(false);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Send initial message if provided (e.g., from clicking an action item)
  useEffect(() => {
    if (initialMessage && open && !initialSentRef.current && messages.length === 0) {
      initialSentRef.current = true;
      handleSend(initialMessage, "text");
    }
  }, [initialMessage, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    async (message: string, source: "text" | "voice") => {
      if (isStreaming) return;

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: message,
        source,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingContent("");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            conversationId,
            projectId,
            source,
          }),
        });

        if (!res.ok) {
          throw new Error(`Chat API error: ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr);

              if (event.type === "conversation_id") {
                setConversationId(event.id);
              } else if (event.type === "text") {
                fullContent += event.content;
                setStreamingContent(fullContent);
              } else if (event.type === "done") {
                setConversationId(event.conversationId);
              } else if (event.type === "error") {
                fullContent = `Error: ${event.message}`;
                setStreamingContent(fullContent);
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }

        // Add assistant message
        if (fullContent) {
          const assistantMsg: Message = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: fullContent,
          };
          setMessages((prev) => [...prev, assistantMsg]);
        }
      } catch (err) {
        const errorMsg: Message = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Sorry, I had trouble connecting. ${err instanceof Error ? err.message : "Please try again."}`,
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
      }
    },
    [isStreaming, conversationId, projectId]
  );

  const handleNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setStreamingContent("");
    initialSentRef.current = false;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={true}
        className="w-full sm:max-w-md md:max-w-lg flex flex-col p-0"
      >
        {/* Header */}
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-amber-400">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <SheetTitle className="text-base">AI Assistant</SheetTitle>
                <SheetDescription className="text-xs">
                  {projectName
                    ? `Project: ${projectName}`
                    : "Penney Construction"}
                </SheetDescription>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleNewChat} title="New chat">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2">
          {messages.length === 0 && !isStreaming ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-12">
              <div className="relative mb-6">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-amber-700 shadow-lg shadow-amber-600/30">
                  <Mic className="h-9 w-9 text-white" />
                </div>
                <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />
              </div>
              <p className="text-base font-semibold text-foreground">How can I help?</p>
              <p className="text-sm mt-1.5 max-w-[280px] text-muted-foreground">
                Tap the mic or type below — I can draft emails, request quotes, follow up with subs, and more.
              </p>
              {/* Quick actions */}
              <div className="flex flex-wrap gap-2 mt-6 justify-center">
                {projectName ? (
                  <>
                    <QuickAction
                      label="What quotes are missing?"
                      onClick={(msg) => handleSend(msg, "text")}
                    />
                    <QuickAction
                      label="Draft a client update email"
                      onClick={(msg) => handleSend(msg, "text")}
                    />
                    <QuickAction
                      label="What's the status of this project?"
                      onClick={(msg) => handleSend(msg, "text")}
                    />
                  </>
                ) : (
                  <>
                    <QuickAction
                      label="What needs my attention today?"
                      onClick={(msg) => handleSend(msg, "text")}
                    />
                    <QuickAction
                      label="Show me overdue todos"
                      onClick={(msg) => handleSend(msg, "text")}
                    />
                    <QuickAction
                      label="Help me draft an email"
                      onClick={(msg) => handleSend(msg, "text")}
                    />
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  source={msg.source}
                />
              ))}
              {isStreaming && streamingContent && (
                <ChatMessage
                  role="assistant"
                  content={streamingContent}
                  isStreaming
                />
              )}
              {isStreaming && !streamingContent && (
                <div className="flex gap-3 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-amber-400">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-1 py-2">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          disabled={isStreaming}
          placeholder={
            projectName
              ? `Ask about ${projectName}...`
              : "Ask me anything..."
          }
        />
      </SheetContent>
    </Sheet>
  );
}

function QuickAction({
  label,
  onClick,
}: {
  label: string;
  onClick: (message: string) => void;
}) {
  return (
    <button
      onClick={() => onClick(label)}
      className="text-xs px-3 py-1.5 rounded-full border bg-background hover:bg-accent transition-colors"
    >
      {label}
    </button>
  );
}

/**
 * Floating button to open the AI Chat panel.
 * Place this in the Command Center layout.
 */
export function AIChatTrigger({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "fixed bottom-6 right-6 z-40 hidden md:flex h-14 w-14 items-center justify-center rounded-full bg-amber-600 text-white shadow-lg hover:bg-amber-700 transition-all hover:scale-105 active:scale-95",
        className
      )}
      title="Open AI Assistant"
    >
      <Bot className="h-6 w-6" />
    </button>
  );
}
