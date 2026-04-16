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
import {
  Bot,
  Mic,
  Plus,
  CheckCircle,
  AlertCircle,
  Loader2,
  Send,
  FolderPlus,
  UserPlus,
  Bell,
  DollarSign,
  CalendarPlus,
  Mail,
  Pencil,
  FileText,
  Download,
  FileSpreadsheet,
  BarChart3,
} from "lucide-react";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmailAutocomplete } from "@/components/ui/email-autocomplete";

// ── Types ──────────────────────────────────────────────

interface ProposedAction {
  id: string;
  type: string;
  label: string;
  data: Record<string, unknown>;
  status: "pending" | "executing" | "approved" | "error";
  error?: string;
  result?: Record<string, unknown>;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "text" | "voice";
  actions?: ProposedAction[];
}

const TOOL_LABELS: Record<string, string> = {
  search_projects: "Searching projects...",
  get_project_details: "Loading project details...",
  search_customers: "Looking up customers...",
  search_subcontractors: "Searching subcontractors...",
  search_emails: "Searching emails...",
  get_email_details: "Reading email...",
  list_quotes: "Checking quotes...",
  list_todos: "Reviewing todos...",
  get_schedule: "Checking schedule...",
};

const ACTION_ICONS: Record<string, React.ElementType> = {
  create_todo: Bell,
  create_project: FolderPlus,
  create_customer: UserPlus,
  create_quote_request: DollarSign,
  update_todo: Bell,
  update_project: Pencil,
  send_email: Mail,
  draft_email: Mail,
  create_schedule_event: CalendarPlus,
  create_schedule_phase: CalendarPlus,
  generate_proposal: FileSpreadsheet,
  generate_change_order_pdf: FileText,
  generate_financial_report: BarChart3,
};

const ACTION_LABELS: Record<string, string> = {
  create_todo: "Create Todo",
  create_project: "Create Project",
  create_customer: "Add Customer",
  create_quote_request: "Create Quote Request",
  update_todo: "Update Todo",
  update_project: "Update Project",
  send_email: "Send Email",
  draft_email: "Send Email",
  create_schedule_event: "Create Calendar Event",
  create_schedule_phase: "Add Schedule Phase",
  generate_proposal: "Generate Proposal",
  generate_change_order_pdf: "Generate Change Order PDF",
  generate_financial_report: "Generate Financial Report",
};

// ── Main Component ─────────────────────────────────────

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
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialSentRef = useRef(false);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Send initial message if provided
  useEffect(() => {
    if (initialMessage && open && !initialSentRef.current && messages.length === 0) {
      initialSentRef.current = true;
      handleSend(initialMessage, "text");
    }
  }, [initialMessage, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    async (message: string, source: "text" | "voice", attachments?: { type: string; filename: string; mimeType: string; storagePath?: string; driveFileId?: string; driveLink?: string }[]) => {
      if (isStreaming) return;

      const displayText = attachments?.length && !message
        ? `(${attachments.map(a => a.filename).join(", ")})`
        : message;

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: displayText,
        source,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingContent("");
      setToolStatus(null);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: message || "See attached files",
            conversationId,
            projectId,
            source,
            attachments,
          }),
        });

        if (!res.ok) {
          throw new Error(`Chat API error: ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullContent = "";
        let pendingActions: ProposedAction[] = [];

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
                setToolStatus(null);
                fullContent += event.content;
                setStreamingContent(fullContent);
              } else if (event.type === "tool_status") {
                if (event.status === "running") {
                  setToolStatus(TOOL_LABELS[event.tool] || `Working...`);
                } else {
                  setToolStatus(null);
                }
              } else if (event.type === "proposed_action") {
                // AI wants to do something — add it as a pending action card
                pendingActions.push({
                  id: event.action_id,
                  type: event.action_type,
                  label: event.label || ACTION_LABELS[event.action_type] || event.action_type,
                  data: event.data,
                  status: "pending",
                });
              } else if (event.type === "done") {
                setToolStatus(null);
                setConversationId(event.conversationId);
              } else if (event.type === "error") {
                setToolStatus(null);
                fullContent = `Error: ${event.message}`;
                setStreamingContent(fullContent);
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }

        // Add assistant message with any proposed actions
        if (fullContent || pendingActions.length > 0) {
          const assistantMsg: Message = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: fullContent,
            actions: pendingActions.length > 0 ? pendingActions : undefined,
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

  // ── Execute an approved action ─────────────────────────

  const handleApproveAction = useCallback(
    async (messageId: string, actionId: string, overrideData?: Record<string, unknown>) => {
      // Find the action
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId || !msg.actions) return msg;
          return {
            ...msg,
            actions: msg.actions.map((a) =>
              a.id === actionId ? { ...a, status: "executing" as const } : a
            ),
          };
        })
      );

      // Find the action data
      const msg = messages.find((m) => m.id === messageId);
      const action = msg?.actions?.find((a) => a.id === actionId);
      if (!action) return;

      const dataToSend = overrideData || action.data;

      try {
        const res = await fetch("/api/chat/execute-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action_type: action.type,
            data: dataToSend,
          }),
        });

        const result = await res.json();

        // If this is a document generation tool with a download URL, auto-open it
        if (result.success && result.result?.document_url) {
          window.open(String(result.result.document_url), "_blank");
        }

        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId || !msg.actions) return msg;
            return {
              ...msg,
              actions: msg.actions.map((a) =>
                a.id === actionId
                  ? {
                      ...a,
                      status: result.success ? ("approved" as const) : ("error" as const),
                      error: result.error || undefined,
                      result: result.success ? result.result : undefined,
                    }
                  : a
              ),
            };
          })
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId || !msg.actions) return msg;
            return {
              ...msg,
              actions: msg.actions.map((a) =>
                a.id === actionId
                  ? {
                      ...a,
                      status: "error" as const,
                      error: err instanceof Error ? err.message : "Failed",
                    }
                  : a
              ),
            };
          })
        );
      }
    },
    [messages]
  );

  const handleNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setStreamingContent("");
    setToolStatus(null);
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
              <div className="flex flex-wrap gap-2 mt-6 justify-center">
                {projectName ? (
                  <>
                    <QuickAction label="What quotes are missing?" onClick={(msg) => handleSend(msg, "text")} />
                    <QuickAction label="Draft a client update email" onClick={(msg) => handleSend(msg, "text")} />
                    <QuickAction label="What's the status of this project?" onClick={(msg) => handleSend(msg, "text")} />
                  </>
                ) : (
                  <>
                    <QuickAction label="What needs my attention today?" onClick={(msg) => handleSend(msg, "text")} />
                    <QuickAction label="Show me overdue todos" onClick={(msg) => handleSend(msg, "text")} />
                    <QuickAction label="Help me draft an email" onClick={(msg) => handleSend(msg, "text")} />
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div key={msg.id}>
                  <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    source={msg.source}
                  />
                  {/* Action cards */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="ml-11 space-y-2 mb-3">
                      {msg.actions.map((action) => (
                        <ActionCard
                          key={action.id}
                          action={action}
                          onApprove={(overrideData) => handleApproveAction(msg.id, action.id, overrideData)}
                        />
                      ))}
                    </div>
                  )}
                </div>
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
                  <div className="flex items-center gap-2 py-2">
                    {toolStatus ? (
                      <span className="text-sm text-amber-400/80 animate-pulse">{toolStatus}</span>
                    ) : (
                      <>
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </>
                    )}
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

// ── Action Card ──────────────────────────────────────────

function ActionCard({
  action,
  onApprove,
}: {
  action: ProposedAction;
  onApprove: (overrideData?: Record<string, unknown>) => void;
}) {
  const isEmail = action.type === "send_email" || action.type === "draft_email";
  const isDocument = action.type === "generate_proposal" || action.type === "generate_change_order_pdf" || action.type === "generate_financial_report";
  const Icon = ACTION_ICONS[action.type] || FileText;
  const [editing, setEditing] = useState(false);
  const [emailTo, setEmailTo] = useState(String(action.data.to || ""));
  const [emailCc, setEmailCc] = useState(String(action.data.cc || ""));
  const [emailSubject, setEmailSubject] = useState(String(action.data.subject || ""));
  const [emailBody, setEmailBody] = useState(String(action.data.body || ""));

  function handleSendEmail() {
    onApprove({ ...action.data, to: emailTo, cc: emailCc || undefined, subject: emailSubject, body: emailBody });
    setEditing(false);
  }

  return (
    <div className="border rounded-xl p-3 bg-background/50 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-amber-500/10 shrink-0">
            <Icon className="h-4 w-4 text-amber-500" />
          </div>
          <span className="text-sm font-medium truncate">{action.label}</span>
        </div>

        {action.status === "pending" && !editing && (
          <Button
            size="sm"
            className="text-xs h-8 px-3 shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => {
              if (isEmail) {
                setEditing(true);
              } else {
                onApprove();
              }
            }}
          >
            {isEmail ? (
              <>
                <Pencil className="h-3 w-3 mr-1" /> Review
              </>
            ) : isDocument ? (
              "Generate"
            ) : (
              "Approve"
            )}
          </Button>
        )}
        {action.status === "executing" && (
          <Loader2 className="h-4 w-4 animate-spin text-amber-500 shrink-0" />
        )}
        {action.status === "approved" && !!action.result?.document_url && (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 px-3 shrink-0 border-green-600 text-green-500 hover:bg-green-500/10"
            onClick={() => window.open(String(action.result!.document_url), "_blank")}
          >
            <Download className="h-3 w-3 mr-1" />
            {String(action.result.document_type) === "xlsx" ? "Download Excel" : "Download PDF"}
          </Button>
        )}
        {action.status === "approved" && !action.result?.document_url && (
          <div className="flex items-center gap-1.5 text-green-500 shrink-0">
            <CheckCircle className="h-4 w-4" />
            <span className="text-xs">Done</span>
          </div>
        )}
        {action.status === "error" && (
          <div className="flex items-center gap-1.5 text-red-500 shrink-0">
            <AlertCircle className="h-4 w-4" />
            <span className="text-xs">Failed</span>
          </div>
        )}
      </div>

      {/* Inline email editor */}
      {isEmail && editing && action.status === "pending" && (
        <div className="ml-8 mt-2 space-y-2 border rounded-lg p-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-8 shrink-0 font-medium">To:</label>
            <EmailAutocomplete
              value={emailTo}
              onChange={setEmailTo}
              placeholder="Start typing a name..."
              className="flex-1 bg-background border border-border rounded-md px-2.5 py-1.5 text-xs h-8 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-8 shrink-0 font-medium">CC:</label>
            <EmailAutocomplete
              value={emailCc}
              onChange={setEmailCc}
              placeholder="Add CC..."
              className="flex-1 bg-background border border-border rounded-md px-2.5 py-1.5 text-xs h-8 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-8 shrink-0 font-medium">Subj:</label>
            <Input
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <Textarea
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            className="text-xs min-h-[120px] resize-none"
            placeholder="Email body..."
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs h-7 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleSendEmail}
            >
              <Send className="h-3 w-3 mr-1" /> Send Email
            </Button>
          </div>
        </div>
      )}

      {/* Action details (non-email or not editing) */}
      {(!isEmail || !editing) && (
        <div className="text-xs text-muted-foreground ml-8 space-y-0.5">
          <ActionDetails action={action} />
        </div>
      )}

      {/* Email body preview (when not editing) */}
      {isEmail && !editing && !!action.data.body && action.status === "pending" && (
        <div className="ml-8 mt-1.5 p-2.5 rounded-lg bg-muted text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">
          {String(action.data.body)}
        </div>
      )}

      {action.status === "error" && action.error && (
        <p className="text-xs text-red-400 ml-8">{action.error}</p>
      )}
    </div>
  );
}

function ActionDetails({ action }: { action: ProposedAction }) {
  const d = action.data;
  const s = (key: string) => (d[key] ? String(d[key]) : "");

  switch (action.type) {
    case "send_email":
    case "draft_email":
      return (
        <>
          <p>To: {s("to")}</p>
          <p>Subject: {s("subject")}</p>
        </>
      );
    case "create_todo":
      return (
        <>
          <p>{s("description")}</p>
          {s("contact_name") ? <p>Contact: {s("contact_name")}</p> : null}
          {s("due_date") ? <p>Due: {s("due_date")}</p> : null}
          {s("priority") ? <p className="capitalize">Priority: {s("priority")}</p> : null}
        </>
      );
    case "create_project":
      return (
        <>
          <p>{s("name")}</p>
          {s("address") ? <p>{s("address")}{s("city") ? `, ${s("city")}` : ""}</p> : null}
          {s("project_type") ? <p className="capitalize">Type: {s("project_type")}</p> : null}
        </>
      );
    case "create_customer":
      return (
        <>
          <p>{s("first_name")} {s("last_name")}</p>
          {s("email") ? <p>{s("email")}</p> : null}
          {s("phone") ? <p>{s("phone")}</p> : null}
        </>
      );
    case "create_quote_request":
      return (
        <>
          <p>{s("subcontractor_name")} — {s("trade")}</p>
          <p>Project: {s("project_name")}</p>
          {d.amount ? <p>${Number(d.amount).toLocaleString()}</p> : null}
        </>
      );
    case "update_todo":
      return (
        <>
          {s("status") ? <p>Status: {s("status")}</p> : null}
          {s("priority") ? <p>Priority: {s("priority")}</p> : null}
        </>
      );
    case "update_project":
      return (
        <>
          {s("status") ? <p>Status: {s("status")}</p> : null}
          {s("description") ? <p>{s("description").substring(0, 100)}</p> : null}
        </>
      );
    case "create_schedule_event":
      return (
        <>
          <p>{s("title")}</p>
          <p>{s("date")} at {s("start_time")}</p>
          {s("location") ? <p>{s("location")}</p> : null}
        </>
      );
    case "create_schedule_phase":
      return (
        <>
          <p>{s("phase_name")}</p>
          {s("planned_start") ? <p>Start: {s("planned_start")}</p> : null}
        </>
      );
    default:
      return <p>{JSON.stringify(d).substring(0, 100)}</p>;
  }
}

// ── Quick Action Pill ──────────────────────────────────

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
