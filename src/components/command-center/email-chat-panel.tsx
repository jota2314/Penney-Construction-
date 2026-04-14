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
  PanelLeft,
  PanelRight,
  Columns2,
  Pencil,
  ChevronDown,
  Mail,
} from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { ChatAttachments, type ChatAttachment } from "@/components/chat/chat-attachments";
import type {
  DisplayMessage,
  ProposedAction,
  DraftState,
  ViewMode,
} from "@/components/command-center/email-detail-types";
import { SUGGESTIONS } from "@/components/command-center/email-detail-types";
import { EditableActionCard } from "@/components/command-center/editable-action-card";

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
  onApproveSingle: (msgIndex: number, actionIndex: number, editedData?: Record<string, unknown>) => void;
  onOpenDraft: (msgIndex: number, actionIndex: number) => void;
  onReadEmail: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  activeDraft: DraftState | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  otherCollapsed?: boolean;
  onShowOther?: () => void;
}

// ── Helpers ─────────────────────────────────────────────────

/** Safety net: if message content is raw JSON with a "message" field, extract it */
function extractMessageText(content: string): string {
  if (!content.startsWith("{")) return content;
  try {
    const obj = JSON.parse(content);
    if (typeof obj.message === "string") return obj.message;
  } catch {
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
  onOpenDraft,
  onReadEmail,
  inputRef,
  activeDraft,
  viewMode,
  onViewModeChange,
  collapsed,
  onToggleCollapse,
  otherCollapsed,
  onShowOther,
}: EmailChatPanelProps) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [emailAttachments, setEmailAttachments] = useState<ChatAttachment[]>([]);
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
      // Text stays in the input — user can review and edit before sending
    } else {
      onInputChange("");
      startListening();
    }
  }

  return (
    <div className={`${viewMode === "email" ? "md:hidden" : collapsed ? "md:flex md:flex-col md:w-auto md:flex-none" : viewMode === "chat" ? "flex-1" : "flex-1 md:flex-none md:w-80 lg:w-96"} flex flex-col bg-muted/30 min-w-0 min-h-0`}>
      {/* Chat header — clickable to toggle */}
      <div className="p-3 border-b flex items-center justify-between shrink-0">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 hover:text-amber-500 transition-colors"
        >
          <Bot className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium">
            {activeDraft ? "Refining Email" : "AI Assistant"}
          </span>
          {onToggleCollapse && (
            <ChevronDown
              className={`h-3.5 w-3.5 text-muted-foreground transition-transform hidden md:block ${collapsed ? "-rotate-90" : ""}`}
            />
          )}
        </button>
        <div className="flex items-center gap-1">
          {/* View mode toggle */}
          <div className="hidden md:flex items-center border rounded-md">
            <button
              onClick={() => onViewModeChange("email")}
              className={`p-1 ${viewMode === "email" ? "bg-muted" : "hover:bg-muted/50"}`}
              title="Email only"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange("split")}
              className={`p-1 ${viewMode === "split" ? "bg-muted" : "hover:bg-muted/50"}`}
              title="Split view"
            >
              <Columns2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange("chat")}
              className={`p-1 ${viewMode === "chat" ? "bg-muted" : "hover:bg-muted/50"}`}
              title="Chat only"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Mobile: toggle between email and chat */}
          <div className="flex md:hidden items-center border rounded-md">
            <button
              onClick={() => onViewModeChange(viewMode === "chat" ? "email" : "chat")}
              className="p-1 hover:bg-muted/50"
            >
              {viewMode === "chat" ? (
                <PanelLeft className="h-3.5 w-3.5" />
              ) : (
                <PanelRight className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {otherCollapsed && onShowOther && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 ml-1 hidden md:flex"
              onClick={onShowOther}
            >
              <Mail className="h-3 w-3 mr-1" />
              Show Email
            </Button>
          )}

          {!processed && (
            <Button
              size="sm"
              className="text-xs h-7 ml-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={onMarkProcessed}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Done
            </Button>
          )}
        </div>
      </div>

      {/* Content below header — hidden when collapsed */}
      {!collapsed && <>

      {/* Draft editing indicator */}
      {activeDraft && (
        <div className="px-3 py-1.5 bg-blue-500/10 border-b text-xs text-blue-400 flex items-center gap-1.5">
          <Pencil className="h-3 w-3" />
          Editing draft to {activeDraft.toName || activeDraft.to}
          <span className="text-blue-400/60">— chat to refine it</span>
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {/* Empty state — Read Email button */}
        {messages.length === 0 && !loading && (
          <div className="text-center py-12 space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Mail className="h-7 w-7 text-amber-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Ready to analyze</p>
              <p className="text-xs text-muted-foreground">
                Tap below to have AI read and analyze this email
              </p>
            </div>
            <Button
              onClick={onReadEmail}
              className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl h-11 px-6 text-sm"
            >
              <Bot className="h-4 w-4 mr-2" />
              Read Email
            </Button>
          </div>
        )}

        {/* Loading state for analyzing */}
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
                className={`text-[15px] leading-relaxed rounded-xl px-4 py-3 max-w-[85%] ${
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
                    <EditableActionCard
                      key={action.id}
                      action={action}
                      onApprove={(editedData) =>
                        onApproveSingle(msgIdx, originalIdx, editedData)
                      }
                      onEditDraft={() =>
                        onOpenDraft(msgIdx, originalIdx)
                      }
                    />
                  ))}

                {msg.proposedActions.filter(
                  (a) => a.status === "pending" && a.type !== "skip"
                ).length > 1 && (
                  <Button
                    size="lg"
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm h-11 rounded-xl"
                    onClick={() => onApproveAll(msgIdx)}
                  >
                    <CheckCheck className="h-4 w-4 mr-2" />
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
        !activeDraft &&
        messages.every(
          (m) =>
            !m.proposedActions?.some((a) => a.status === "approved")
        ) && (
          <div className="px-4 pb-2 flex flex-wrap gap-2 shrink-0">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onSend(s)}
                className="text-sm px-3 py-1.5 rounded-full bg-muted hover:bg-amber-500/10 hover:text-amber-500 text-muted-foreground transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

      {/* Chat input */}
      <div className="p-4 border-t shrink-0">
        {emailAttachments.length > 0 && (
          <div className="mb-2">
            <ChatAttachments
              attachments={emailAttachments}
              onAttachmentsChange={setEmailAttachments}
              disabled={loading}
            />
          </div>
        )}
        <div className="flex gap-3 items-end">
          {emailAttachments.length === 0 && (
            <ChatAttachments
              attachments={emailAttachments}
              onAttachmentsChange={setEmailAttachments}
              disabled={loading}
            />
          )}
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isListening
                ? "Listening... speak now"
                : activeDraft
                  ? "Tell AI how to improve the email..."
                  : "Tell me what to do..."
            }
            disabled={loading}
            className={`text-base h-12 rounded-xl px-4 ${isListening ? "border-red-400 bg-red-50 dark:bg-red-950/20" : ""}`}
          />
          {isSupported && (
            <Button
              variant={isListening ? "destructive" : "outline"}
              size="icon"
              onClick={toggleVoice}
              disabled={loading}
              className="shrink-0 h-12 w-12 rounded-xl"
            >
              {isListening ? (
                <MicOff className="h-5 w-5" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </Button>
          )}
          <Button
            onClick={() => onSend()}
            disabled={loading || !input.trim()}
            size="icon"
            className="shrink-0 h-12 w-12 rounded-xl bg-amber-600 hover:bg-amber-700"
          >
            {loading ? (
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

      </>}
    </div>
  );
}

