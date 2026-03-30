"use client";

import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send,
  Loader2,
  Bot,
  User,
  CheckCircle,
  FileText,
  CheckCheck,
  AlertCircle,
  Mic,
  MicOff,
} from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import type { DisplayMessage, ProposedAction } from "@/components/command-center/email-detail-types";
import { ACTION_ICONS, SUGGESTIONS } from "@/components/command-center/email-detail-types";

// ── Props ────────────────────────────────────────────────────────

interface EmailChatPanelProps {
  messages: DisplayMessage[];
  loading: boolean;
  processed: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (overrideText?: string) => void;
  onMarkProcessed: () => void;
  onApproveAll: (msgIndex: number) => void;
  onApproveSingle: (msgIndex: number, actionIndex: number) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

// ── Helpers ─────────────────────────────────────────────────

/** Safety net: if message content is raw JSON with a "message" field, extract it */
function extractMessageText(content: string): string {
  if (!content.startsWith("{")) return content;
  try {
    const obj = JSON.parse(content);
    if (typeof obj.message === "string") return obj.message;
  } catch {
    // Try regex fallback for malformed JSON
    const match = content.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match) {
      try {
        return JSON.parse(`"${match[1]}"`);
      } catch {
        return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
      }
    }
  }
  return content;
}

// ── Component ───────────────────────────────────────────────────

export function EmailChatPanel({
  messages,
  loading,
  processed,
  input,
  onInputChange,
  onSend,
  onMarkProcessed,
  onApproveAll,
  onApproveSingle,
  inputRef,
}: EmailChatPanelProps) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { isListening, transcript, startListening, stopListening, isSupported } =
    useSpeechRecognition();

  // When voice transcript updates, show it in the input
  useEffect(() => {
    if (transcript) {
      onInputChange(transcript);
    }
  }, [transcript, onInputChange]);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  function toggleVoice() {
    if (isListening) {
      stopListening();
      // Auto-send after stopping voice if there's content
      if (input.trim()) {
        setTimeout(() => {
          onSend();
        }, 300);
      }
    } else {
      onInputChange("");
      startListening();
    }
  }

  return (
    <div className="flex-1 md:flex-none md:w-80 lg:w-96 flex flex-col bg-muted/30 min-w-0 min-h-0">
      {/* Chat header */}
      <div className="p-3 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium">AI Assistant</span>
        </div>
        {!processed && messages.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={onMarkProcessed}
          >
            <CheckCheck className="h-3 w-3 mr-1" />
            Done
          </Button>
        )}
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {/* Loading state for auto-analyze */}
        {messages.length === 0 && loading && (
          <div className="text-center py-8 space-y-2">
            <Loader2 className="h-6 w-6 animate-spin text-amber-500 mx-auto" />
            <p className="text-xs text-muted-foreground">
              Reading this email...
            </p>
          </div>
        )}

        {messages.map((msg, msgIdx) => (
          <div key={msgIdx}>
            {/* Message bubble */}
            <div
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}
            >
              {msg.role === "assistant" && (
                <Bot className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              )}
              <div
                className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                  msg.role === "user"
                    ? "bg-amber-500/20 text-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                <p className="whitespace-pre-wrap">{extractMessageText(msg.content)}</p>
              </div>
              {msg.role === "user" && (
                <User className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              )}
            </div>

            {/* Action cards */}
            {msg.proposedActions && msg.proposedActions.length > 0 && (
              <div className="ml-7 mt-2 space-y-2">
                {msg.proposedActions
                  .map((action, originalIdx) => ({ action, originalIdx }))
                  .filter(({ action }) => action.type !== "skip")
                  .map(({ action, originalIdx }) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      onApprove={() =>
                        onApproveSingle(msgIdx, originalIdx)
                      }
                    />
                  ))}

                {msg.proposedActions.filter(
                  (a) => a.status === "pending" && a.type !== "skip"
                ).length > 1 && (
                  <Button
                    size="sm"
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white text-xs"
                    onClick={() => onApproveAll(msgIdx)}
                  >
                    <CheckCheck className="h-3 w-3 mr-1.5" />
                    Approve All
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Loading for user messages */}
        {messages.length > 0 && loading && (
          <div className="flex gap-2">
            <Bot className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Suggestions */}
      {messages.length > 0 &&
        !loading &&
        messages.every(
          (m) =>
            !m.proposedActions?.some((a) => a.status === "approved")
        ) && (
          <div className="px-3 pb-1 flex flex-wrap gap-1 shrink-0">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onSend(s)}
                className="text-[10px] px-2 py-1 rounded-full bg-muted hover:bg-amber-500/10 hover:text-amber-500 text-muted-foreground transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

      {/* Chat input */}
      <div className="p-3 border-t shrink-0">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? "Listening... speak now" : "Tell me what to do..."}
            disabled={loading}
            className={`text-sm ${isListening ? "border-red-400 bg-red-50 dark:bg-red-950/20" : ""}`}
          />
          {isSupported && (
            <Button
              variant={isListening ? "destructive" : "outline"}
              size="icon"
              onClick={toggleVoice}
              disabled={loading}
              className="shrink-0"
            >
              {isListening ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            onClick={() => onSend()}
            disabled={loading || !input.trim()}
            size="icon"
            className="shrink-0"
          >
            {loading ? (
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
    </div>
  );
}

// ── Action Card ──────────────────────────────────────────────────

function ActionCard({
  action,
  onApprove,
}: {
  action: ProposedAction;
  onApprove: () => void;
}) {
  const Icon = ACTION_ICONS[action.type] || FileText;

  return (
    <div className="border rounded-lg p-2.5 bg-background/50 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded bg-amber-500/10 shrink-0">
            <Icon className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <span className="text-xs font-medium truncate">{action.label}</span>
        </div>
        {action.status === "pending" && (
          <Button
            size="sm"
            variant="outline"
            className={`text-[10px] h-6 px-2 shrink-0 ${action.type === "draft_reply" ? "bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20" : ""}`}
            onClick={onApprove}
          >
            {action.type === "draft_reply" ? (
              <>
                <Send className="h-2.5 w-2.5 mr-1" />
                Send
              </>
            ) : (
              "Approve"
            )}
          </Button>
        )}
        {action.status === "executing" && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />
        )}
        {action.status === "approved" && (
          <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
        )}
        {action.status === "error" && (
          <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        )}
      </div>

      <div className="text-[10px] text-muted-foreground ml-7 space-y-0.5">
        {formatActionDetails(action)}
      </div>

      {action.status === "error" && action.error ? (
        <p className="text-[10px] text-red-400 ml-7">{action.error}</p>
      ) : null}

      {action.type === "draft_reply" && action.data.body ? (
        <div className="ml-7 mt-1 p-2 rounded bg-muted text-[11px] text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">
          {String(action.data.body)}
        </div>
      ) : null}
    </div>
  );
}

// ── Format Action Details ────────────────────────────────────────

function formatActionDetails(action: ProposedAction): React.ReactNode {
  const d = action.data;

  switch (action.type) {
    case "create_project":
      return (
        <>
          {d.status ? (
            <span className="capitalize">{String(d.status)}</span>
          ) : null}
          {d.project_type ? <> &middot; {String(d.project_type)}</> : null}
          {d.address ? (
            <span className="block">
              {String(d.address)}
              {d.city ? `, ${String(d.city)}` : ""}
              {d.state ? ` ${String(d.state)}` : ""}
            </span>
          ) : null}
          {d.customer_name ? (
            <span className="block">Client: {String(d.customer_name)}</span>
          ) : null}
        </>
      );

    case "update_project":
      return (
        <>
          {d.project_name ? (
            <span>Project: {String(d.project_name)}</span>
          ) : null}
          {d.address ? (
            <span className="block">Address: {String(d.address)}</span>
          ) : null}
          {d.status ? (
            <span className="block">Status: {String(d.status)}</span>
          ) : null}
        </>
      );

    case "create_customer":
      return (
        <>
          {d.email ? <span>{String(d.email)}</span> : null}
          {d.phone ? <span className="block">{String(d.phone)}</span> : null}
        </>
      );

    case "create_subcontractor":
      return (
        <>
          {d.contact_name ? <span>{String(d.contact_name)}</span> : null}
          {d.trades ? (
            <span className="block">
              Trades: {(d.trades as string[]).join(", ")}
            </span>
          ) : null}
        </>
      );

    case "create_quote":
      return (
        <>
          {d.project_name ? (
            <span>For: {String(d.project_name)}</span>
          ) : null}
          {d.trade ? <> &middot; {String(d.trade)}</> : null}
          {d.amount ? (
            <span className="block font-medium text-green-500">
              ${Number(d.amount).toLocaleString()}
            </span>
          ) : null}
        </>
      );

    case "create_follow_up":
      return (
        <>
          {d.description ? (
            <span className="line-clamp-2">{String(d.description)}</span>
          ) : null}
          {d.priority ? (
            <span className="block capitalize">
              Priority: {String(d.priority)}
            </span>
          ) : null}
        </>
      );

    case "link_email_to_project":
      return d.project_name ? (
        <span>Link to: {String(d.project_name)}</span>
      ) : null;

    case "draft_reply":
      return (
        <>
          {d.to_email ? (
            <span>To: {d.to_name ? `${String(d.to_name)} ` : ""}<span className="text-muted-foreground/70">&lt;{String(d.to_email)}&gt;</span></span>
          ) : d.to_name ? (
            <span>To: {String(d.to_name)}</span>
          ) : null}
          {d.cc ? (
            <span className="block">CC: <span className="text-muted-foreground/70">{String(d.cc)}</span></span>
          ) : null}
          {d.subject ? (
            <span className="block">Re: {String(d.subject)}</span>
          ) : null}
        </>
      );

    default:
      return null;
  }
}
