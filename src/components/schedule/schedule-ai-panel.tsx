"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  MicOff,
  Send,
  Bot,
  Calendar,
  CheckCircle,
  Loader2,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useRouter } from "next/navigation";
import { renderInlineMarkdown } from "@/lib/chat-markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  scheduleActions?: {
    action: string;
    name: string;
    project_name?: string;
    start_date?: string;
    end_date?: string;
    assigned_to?: string[];
  }[];
  executed?: string[];
}

export function ScheduleAIPanel() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported,
  } = useSpeechRecognition();

  useEffect(() => {
    if (transcript) setInput(transcript);
  }, [transcript]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    stopListening();

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch("/api/schedule-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          userMessage: text,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.message || "I'm not sure how to help with that.",
          scheduleActions: data.schedule_actions,
          executed: data.executed,
        },
      ]);

      // Refresh schedule if actions were executed
      if (data.executed?.length > 0) {
        router.refresh();
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Failed"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function toggleVoice() {
    if (isListening) {
      stopListening();
    } else {
      setInput("");
      startListening();
    }
  }

  // Closed state — floating button
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open schedule assistant"
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,1rem))] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/30 transition-transform hover:scale-105 sm:bottom-6 sm:right-6 sm:h-14 sm:w-14"
      >
        <Bot className="h-6 w-6" />
      </button>
    );
  }

  const panelClasses = expanded
    ? "fixed inset-3 z-50 sm:inset-4"
    : "fixed inset-x-3 top-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom,1rem))] z-50 sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[600px] sm:max-h-[80vh] sm:w-[420px]";

  return (
    <>
      {/* Backdrop when expanded */}
      {expanded && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setExpanded(false)}
        />
      )}

      <div
        className={`${panelClasses} flex flex-col rounded-2xl border border-amber-500/20 bg-background shadow-2xl shadow-amber-500/10 overflow-hidden`}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b bg-gradient-to-r from-amber-500/10 to-orange-500/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Calendar className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold">Schedule Assistant</p>
              <p className="text-[10px] text-muted-foreground">
                Friday Planning Meeting
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "Minimize schedule assistant" : "Expand schedule assistant"}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {expanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close schedule assistant"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* Welcome state */}
          {messages.length === 0 && !loading && (
            <div className="text-center py-8 space-y-4">
              <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                <Calendar className="h-8 w-8 text-amber-500" />
              </div>
              <div className="space-y-2">
                <p className="text-base font-semibold">
                  Ready for the scheduling meeting
                </p>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                  I know all your projects, crew, and current schedule.
                  Let&apos;s plan next week.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  "What's on the schedule this week?",
                  "Who's available next week?",
                  "What projects need attention?",
                  "Show me what's behind schedule",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setInput(q);
                      setTimeout(() => handleSend(), 50);
                    }}
                    className="text-xs px-3 py-1.5 rounded-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="bg-amber-600/20 border border-amber-600/30 rounded-2xl rounded-br-md px-4 py-2.5 max-w-[85%]">
                    <p className="text-sm">{msg.content}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-white" />
                    </div>
                    <div className="bg-muted/50 border rounded-2xl rounded-bl-md px-4 py-2.5 max-w-[85%]">
                      <p className="text-sm whitespace-pre-wrap">
                        {renderInlineMarkdown(msg.content)}
                      </p>
                    </div>
                  </div>

                  {/* Schedule actions created */}
                  {msg.executed && msg.executed.length > 0 && (
                    <div className="ml-9 space-y-1">
                      {msg.executed.map((action, j) => (
                        <div
                          key={j}
                          className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-1.5"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          {action}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Proposed schedule actions */}
                  {msg.scheduleActions &&
                    msg.scheduleActions.length > 0 &&
                    (!msg.executed || msg.executed.length === 0) && (
                      <div className="ml-9 space-y-1">
                        {msg.scheduleActions.map((action, j) => (
                          <div
                            key={j}
                            className="text-xs bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <Badge className="bg-violet-500 text-white text-[10px]">
                                {action.action}
                              </Badge>
                              <span className="font-medium">{action.name}</span>
                            </div>
                            {action.project_name && (
                              <p className="text-muted-foreground mt-0.5">
                                {action.project_name} | {action.start_date}
                                {action.end_date && action.end_date !== action.start_date
                                  ? ` — ${action.end_date}`
                                  : ""}
                              </p>
                            )}
                            {action.assigned_to && action.assigned_to.length > 0 && (
                              <p className="text-muted-foreground">
                                Crew: {action.assigned_to.join(", ")}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              )}
            </div>
          ))}

          {/* Loading */}
          {loading && (
            <div className="flex gap-2 items-center">
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0">
                <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
              </div>
              <div className="flex gap-1">
                <div className="h-2 w-2 rounded-full bg-amber-400 animate-bounce [animation-delay:0ms]" />
                <div className="h-2 w-2 rounded-full bg-amber-400 animate-bounce [animation-delay:150ms]" />
                <div className="h-2 w-2 rounded-full bg-amber-400 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Voice-first input */}
        <div className="shrink-0 border-t bg-background/80 backdrop-blur-sm p-3">
          {isListening ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />
                <button
                  onClick={toggleVoice}
                  className="relative h-14 w-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shadow-lg"
                >
                  <MicOff className="h-6 w-6" />
                </button>
              </div>
              <p className="text-xs text-amber-400 animate-pulse">
                Listening... tap to stop
              </p>
              {input && (
                <p className="text-xs text-muted-foreground text-center max-w-sm">
                  {input}
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Talk about the schedule..."
                rows={1}
                disabled={loading}
                className="flex-1 min-h-[44px] max-h-[100px] resize-none rounded-xl border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              {isSupported && (
                <button
                  onClick={toggleVoice}
                  disabled={loading}
                  className="shrink-0 h-11 w-11 rounded-xl border flex items-center justify-center text-muted-foreground hover:text-amber-400 hover:border-amber-500/30 transition-colors"
                >
                  <Mic className="h-5 w-5" />
                </button>
              )}
              <Button
                size="icon"
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="shrink-0 h-11 w-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
