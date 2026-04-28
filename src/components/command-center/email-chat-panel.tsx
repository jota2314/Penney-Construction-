"use client";

import { useRef, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send,
  Loader2,
  Bot,
  User,
  CheckCheck,
  Mic,
  MicOff,
  PanelLeft,
  PanelRight,
  Columns2,
  Pencil,
  ChevronDown,
  Mail,
  AlertCircle,
  FolderOpen,
  Wrench,
  UserCircle,
  Reply,
  Sparkles,
} from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { renderInlineMarkdown } from "@/lib/chat-markdown";
import { ChatAttachments, type ChatAttachment } from "@/components/chat/chat-attachments";
import type {
  DisplayMessage,
  DraftState,
  ViewMode,
  StoredEmail,
  MatchedEntityNames,
} from "@/components/command-center/email-detail-types";
import { SUGGESTIONS } from "@/components/command-center/email-detail-types";
import { EditableActionCard } from "@/components/command-center/editable-action-card";
import {
  deriveQuickActions,
  type QuickAction,
} from "@/lib/email/quick-actions";

// ── Props ────────────────────────────────────────────────────────

interface EmailChatPanelProps {
  email: StoredEmail;
  matchedNames?: MatchedEntityNames;
  messages: DisplayMessage[];
  loading: boolean;
  processed: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (overrideText?: string, attachments?: ChatAttachment[]) => void;
  onMarkProcessed: () => void;
  onApproveAll: (msgIndex: number) => void;
  onApproveSingle: (msgIndex: number, actionIndex: number, editedData?: Record<string, unknown>) => void;
  onOpenDraft: (msgIndex: number, actionIndex: number) => void;
  onReadEmail: () => void;
  /** Quick Reply chip — opens the bottom sheet with an AI draft. */
  onQuickReply: () => void;
  /** Backfill: classify this single email if Haiku hasn't yet. */
  onClassifyNow: () => void;
  /** True while /api/email/classify-one is running. */
  classifying: boolean;
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
  email,
  matchedNames,
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
  onQuickReply,
  onClassifyNow,
  classifying,
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
      handleSendWithAttachments();
    }
  }

  function handleSendWithAttachments() {
    // Pass attachments to the parent, then clear them
    if (emailAttachments.length > 0) {
      onSend(undefined, emailAttachments);
      setEmailAttachments([]);
    } else {
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
        {/* Empty state — Haiku summary card + quick-action chips */}
        {messages.length === 0 && !loading && (
          <EmailSummaryCard
            email={email}
            matchedNames={matchedNames}
            classifying={classifying}
            onClassifyNow={onClassifyNow}
            onQuickReply={onQuickReply}
            onChipPrompt={(prompt) => onSend(prompt)}
            onMarkDone={onMarkProcessed}
            onReadEmail={onReadEmail}
          />
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
                <p className="whitespace-pre-wrap">
                  {msg.role === "user"
                    ? extractMessageText(msg.content)
                    : renderInlineMarkdown(extractMessageText(msg.content))}
                </p>
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
            onClick={handleSendWithAttachments}
            disabled={loading || (!input.trim() && emailAttachments.length === 0)}
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

// ── Summary card ────────────────────────────────────────────────

const URGENCY_STYLES: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-400 border-red-500/30",
  normal: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
  junk: "bg-muted/50 text-muted-foreground border-border",
};

const CONTENT_LABELS: Record<string, string> = {
  invoice: "Invoice",
  quote: "Quote",
  payment_receipt: "Payment",
  schedule: "Schedule",
  contract: "Contract",
  inquiry: "Inquiry",
  update: "Update",
  newsletter: "Newsletter",
  other: "Other",
};

interface EmailSummaryCardProps {
  email: StoredEmail;
  matchedNames?: MatchedEntityNames;
  classifying: boolean;
  onClassifyNow: () => void;
  onQuickReply: () => void;
  onChipPrompt: (prompt: string) => void;
  onMarkDone: () => void;
  onReadEmail: () => void;
}

function EmailSummaryCard({
  email,
  matchedNames,
  classifying,
  onClassifyNow,
  onQuickReply,
  onChipPrompt,
  onMarkDone,
  onReadEmail,
}: EmailSummaryCardProps) {
  // Auto-trigger backfill if Haiku hasn't classified yet
  useEffect(() => {
    if (!email.ai_classified_at && !classifying) {
      onClassifyNow();
    }
    // Only run on mount for a given email
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.id]);

  // Not classified yet — placeholder
  if (!email.ai_classified_at) {
    return (
      <div className="py-12 space-y-3 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-amber-500 mx-auto" />
        <p className="text-xs text-muted-foreground">
          {classifying ? "Analyzing…" : "Waiting on classifier…"}
        </p>
      </div>
    );
  }

  const urgency = email.urgency || "normal";
  const urgencyClass = URGENCY_STYLES[urgency] || URGENCY_STYLES.normal;
  const contentLabel =
    CONTENT_LABELS[email.content_type || "other"] || "Other";
  const isUrgent = urgency === "urgent";

  const chips: QuickAction[] = deriveQuickActions(email);

  function runChip(chip: QuickAction) {
    switch (chip.intent) {
      case "quick_reply":
        onQuickReply();
        return;
      case "mark_done":
        onMarkDone();
        return;
      default:
        onChipPrompt(chip.prompt);
    }
  }

  return (
    <div className="space-y-3 px-1 pt-1">
      {/* Headline chip */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${urgencyClass}`}
        >
          {isUrgent && <AlertCircle className="h-3 w-3" />}
          {urgency === "urgent" ? "Urgent" : urgency === "junk" ? "Junk" : urgency.charAt(0).toUpperCase() + urgency.slice(1)}
          <span className="opacity-50">·</span>
          {contentLabel}
        </span>
        {email.ai_action_required && (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-500">
            Needs reply
          </span>
        )}
      </div>

      {/* AI summary line */}
      {email.ai_summary && (
        <p className="text-sm text-foreground/90 leading-relaxed">
          {email.ai_summary}
        </p>
      )}

      {/* Matched chips */}
      {(matchedNames?.project || matchedNames?.customer || matchedNames?.sub) && (
        <div className="flex flex-wrap gap-1.5">
          {matchedNames.project && email.matched_project_id && (
            <Link
              href={`/projects/${email.matched_project_id}`}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors max-w-full"
            >
              <FolderOpen className="h-3 w-3 shrink-0" />
              <span className="truncate">{matchedNames.project}</span>
            </Link>
          )}
          {matchedNames.customer && email.matched_customer_id && (
            <Link
              href={`/customers/${email.matched_customer_id}`}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors max-w-full"
            >
              <UserCircle className="h-3 w-3 shrink-0" />
              <span className="truncate">{matchedNames.customer}</span>
            </Link>
          )}
          {matchedNames.sub && email.matched_subcontractor_id && (
            <Link
              href={`/subcontractors/${email.matched_subcontractor_id}`}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors max-w-full"
            >
              <Wrench className="h-3 w-3 shrink-0" />
              <span className="truncate">{matchedNames.sub}</span>
            </Link>
          )}
        </div>
      )}

      {/* Quick-action chips */}
      <div className="flex flex-wrap gap-2 pt-1">
        {chips.map((chip) => (
          <ChipButton key={chip.id} chip={chip} onClick={() => runChip(chip)} />
        ))}
      </div>

      {/* Read Email — secondary, kicks off the full Sonnet triage */}
      <div className="pt-2 border-t border-border/50 mt-2">
        <button
          onClick={onReadEmail}
          className="w-full text-xs text-muted-foreground hover:text-foreground py-2 inline-flex items-center justify-center gap-1.5 transition-colors"
        >
          <Sparkles className="h-3 w-3" />
          Deep analysis with AI
        </button>
      </div>
    </div>
  );
}

function ChipButton({
  chip,
  onClick,
}: {
  chip: QuickAction;
  onClick: () => void;
}) {
  const Icon =
    chip.intent === "quick_reply"
      ? Reply
      : chip.intent === "mark_done"
        ? CheckCheck
        : null;

  const base =
    "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors whitespace-nowrap";
  const variant =
    chip.variant === "primary"
      ? "bg-amber-600 hover:bg-amber-700 text-white"
      : chip.variant === "ghost"
        ? "text-muted-foreground hover:text-foreground hover:bg-muted"
        : "bg-muted hover:bg-amber-500/15 hover:text-amber-500";

  return (
    <button onClick={onClick} className={`${base} ${variant}`}>
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {chip.label}
    </button>
  );
}

