"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Paperclip,
  Send,
  Loader2,
  Bot,
  User,
  CheckCircle,
  FileText,
  FolderPlus,
  UserPlus,
  DollarSign,
  Bell,
  Link2,
  Reply,
  SkipForward,
  Pencil,
  CheckCheck,
  AlertCircle,
  ExternalLink,
  Download,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  markEmailProcessed,
  linkEmailToProject as serverLinkEmail,
  sendEmailReply,
} from "@/lib/actions/email-actions";
import { saveApprovedDraft } from "@/lib/actions/ai-email-engine";

// ── Types ────────────────────────────────────────────────────────

interface StoredEmail {
  id: string;
  gmail_message_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  to_name: string;
  to_email: string;
  date: string;
  direction: string;
  body: string;
  snippet: string;
  is_processed: boolean;
  project_id: string | null;
  attachments: {
    filename: string;
    mimeType: string;
    size: number;
    storage_path: string | null;
  }[];
}

interface ProjectRef {
  id: string;
  name: string;
  status: string;
  project_type: string;
}

interface ProposedAction {
  id: string;
  type: string;
  label: string;
  data: Record<string, unknown>;
  status: "pending" | "executing" | "approved" | "error";
  error?: string;
}

interface DisplayMessage {
  dbId?: string; // conversation_messages ID for persisting action status
  role: "user" | "assistant";
  content: string;
  proposedActions?: ProposedAction[];
}

interface ExistingConversation {
  id: string;
  messages: {
    id: string;
    role: string;
    content: string;
    source: string | null;
    metadata: Record<string, unknown> | null;
  }[];
}

interface EmailDetailProps {
  email: StoredEmail;
  projects: ProjectRef[];
  userName: string;
  existingConversation: ExistingConversation | null;
}

// ── Constants ────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, React.ElementType> = {
  create_project: FolderPlus,
  update_project: Pencil,
  create_customer: UserPlus,
  create_subcontractor: UserPlus,
  create_quote: DollarSign,
  create_follow_up: Bell,
  link_email_to_project: Link2,
  draft_reply: Reply,
  skip: SkipForward,
};

const SUGGESTIONS = [
  "Create a new project from this",
  "Reply to this email",
  "This is a sub quote — log it",
  "Link to an existing project",
  "Skip — not relevant",
];

// ── Main Component ───────────────────────────────────────────────

export function EmailDetail({
  email,
  projects,
  userName,
  existingConversation,
}: EmailDetailProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [processed, setProcessed] = useState(email.is_processed);
  const [conversationId, setConversationId] = useState<string | null>(
    existingConversation?.id ?? null
  );
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoAnalyzed = useRef(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [previewMimeType, setPreviewMimeType] = useState("");
  const router = useRouter();

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Load existing conversation OR auto-analyze
  useEffect(() => {
    if (autoAnalyzed.current) return;
    autoAnalyzed.current = true;

    if (existingConversation?.messages.length) {
      // Restore saved messages
      const loaded: DisplayMessage[] = existingConversation.messages
        .filter((m) => m.source !== "auto_analyze_prompt")
        .map((m) => {
          const meta = m.metadata as {
            proposed_actions?: {
              type: string;
              label: string;
              data: Record<string, unknown>;
              status?: string;
            }[];
          } | null;

          return {
            dbId: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            proposedActions: meta?.proposed_actions?.map((a, j) => ({
              ...a,
              id: `loaded-${m.id}-${j}`,
              status: (a.status as ProposedAction["status"]) || "approved",
            })),
          };
        });
      setMessages(loaded);
      // Focus input for continuing the conversation
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // Auto-analyze: AI reads the email immediately
      fireAutoAnalyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-analyze on mount
  async function fireAutoAnalyze() {
    setLoading(true);
    try {
      const res = await fetch("/api/email-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId: email.id,
          messages: [],
          autoAnalyze: true,
          conversationId,
          userName,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.conversationId) setConversationId(data.conversationId);

      const assistantMsg: DisplayMessage = {
        dbId: data.assistantMessageId || undefined,
        role: "assistant",
        content: data.message,
        proposedActions: (data.proposed_actions || []).map(
          (
            a: { type: string; label: string; data: Record<string, unknown> },
            i: number
          ) => ({
            ...a,
            id: `auto-${Date.now()}-${i}`,
            status: "pending" as const,
          })
        ),
      };
      setMessages([assistantMsg]);
    } catch (err) {
      setMessages([
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Failed to connect to AI"}`,
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  // Send user message
  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText || input).trim();
      if (!text || loading) return;

      if (!overrideText) setInput("");
      const userMsg: DisplayMessage = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const history = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/email-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            emailId: email.id,
            messages: history,
            userMessage: text,
            conversationId,
            userName,
          }),
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (data.conversationId) setConversationId(data.conversationId);

        const assistantMsg: DisplayMessage = {
          dbId: data.assistantMessageId || undefined,
          role: "assistant",
          content: data.message,
          proposedActions: (data.proposed_actions || []).map(
            (
              a: {
                type: string;
                label: string;
                data: Record<string, unknown>;
              },
              i: number
            ) => ({
              ...a,
              id: `msg-${Date.now()}-${i}`,
              status: "pending" as const,
            })
          ),
        };
        setMessages((prev) => [...prev, assistantMsg]);
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
    },
    [input, loading, messages, email.id, conversationId]
  );

  // ── Action execution ───────────────────────────────────────

  async function executeActions(
    actions: { type: string; data: Record<string, unknown> }[]
  ) {
    const dbActions = actions.filter(
      (a) =>
        !["draft_reply", "skip", "link_email_to_project"].includes(a.type)
    );

    let result = {
      projectsCreated: 0,
      customersCreated: 0,
      subsCreated: 0,
      quotesCreated: 0,
      followUpsCreated: 0,
      stagesUpdated: 0,
      errors: [] as string[],
    };

    if (dbActions.length > 0) {
      result = await saveApprovedDraft(dbActions);
    }

    // Handle link_email_to_project or auto-link when project created
    const linkAction = actions.find(
      (a) => a.type === "link_email_to_project"
    );
    if (linkAction || actions.some((a) => a.type === "create_project")) {
      const projectName =
        (linkAction?.data?.project_name as string) ||
        (actions.find((a) => a.type === "create_project")?.data
          ?.name as string);
      if (projectName) {
        await linkEmailToProject(projectName);
      }
    }

    // Handle draft_reply — actually send via Gmail
    const replyAction = actions.find((a) => a.type === "draft_reply");
    if (replyAction) {
      const d = replyAction.data;
      const sendResult = await sendEmailReply({
        to: (d.to_email as string) || email.from_email,
        subject: (d.subject as string) || `Re: ${email.subject}`,
        body: (d.body as string) || "",
        replyTo: email.from_email,
      });
      if (!sendResult.success) {
        result.errors.push(sendResult.error || "Failed to send reply");
      }
    }

    return result;
  }

  async function linkEmailToProject(projectName: string) {
    await serverLinkEmail(email.id, projectName);
  }

  // Persist action status to conversation_messages metadata
  async function persistActionStatus(
    dbId: string | undefined,
    updatedActions: ProposedAction[]
  ) {
    if (!dbId) return;
    const supabase = createClient();
    await supabase
      .from("conversation_messages")
      .update({
        metadata: {
          proposed_actions: updatedActions.map((a) => ({
            type: a.type,
            label: a.label,
            data: a.data,
            status: a.status,
          })),
        },
      })
      .eq("id", dbId);
  }

  // Approve all actions in a message
  async function handleApproveAll(msgIndex: number) {
    const msg = messages[msgIndex];
    if (!msg?.proposedActions) return;

    const pending = msg.proposedActions.filter(
      (a) => a.status === "pending" && a.type !== "skip"
    );
    if (pending.length === 0) return;

    // Mark executing
    setMessages((prev) =>
      prev.map((m, i) =>
        i === msgIndex
          ? {
              ...m,
              proposedActions: m.proposedActions?.map((a) =>
                a.status === "pending" && a.type !== "skip"
                  ? { ...a, status: "executing" as const }
                  : a
              ),
            }
          : m
      )
    );

    try {
      const actionsToExecute = pending.map((a) => ({
        type: a.type,
        data: a.data,
      }));
      const result = await executeActions(actionsToExecute);

      const hasErrors = result.errors.length > 0;

      // Update state
      const updatedMessages = messages.map((m, i) =>
        i === msgIndex
          ? {
              ...m,
              proposedActions: m.proposedActions?.map((a) =>
                a.status === "executing" || a.status === "pending"
                  ? {
                      ...a,
                      status: (a.type === "skip"
                        ? "approved"
                        : hasErrors
                          ? "error"
                          : "approved") as ProposedAction["status"],
                      error: hasErrors
                        ? result.errors.join(", ")
                        : undefined,
                    }
                  : a
              ),
            }
          : m
      );
      setMessages(updatedMessages);

      // Persist to DB
      const updatedMsg = updatedMessages[msgIndex];
      if (updatedMsg.proposedActions) {
        persistActionStatus(updatedMsg.dbId, updatedMsg.proposedActions);
      }

      // Add summary
      const parts: string[] = [];
      if (result.projectsCreated > 0)
        parts.push(`${result.projectsCreated} project(s)`);
      if (result.customersCreated > 0)
        parts.push(`${result.customersCreated} customer(s)`);
      if (result.subsCreated > 0)
        parts.push(`${result.subsCreated} subcontractor(s)`);
      if (result.quotesCreated > 0)
        parts.push(`${result.quotesCreated} quote(s)`);
      if (result.followUpsCreated > 0)
        parts.push(`${result.followUpsCreated} follow-up(s)`);
      if (result.stagesUpdated > 0)
        parts.push(`${result.stagesUpdated} update(s)`);

      const summary =
        parts.length > 0
          ? `Done! Created: ${parts.join(", ")}.`
          : "Actions executed.";

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            summary +
            (result.errors.length > 0
              ? ` Errors: ${result.errors.join(", ")}`
              : ""),
        },
      ]);

      router.refresh();
    } catch (err) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIndex
            ? {
                ...m,
                proposedActions: m.proposedActions?.map((a) =>
                  a.status === "executing"
                    ? {
                        ...a,
                        status: "error" as const,
                        error:
                          err instanceof Error ? err.message : "Failed",
                      }
                    : a
                ),
              }
            : m
        )
      );
    }
  }

  // Approve single action
  async function handleApproveSingle(
    msgIndex: number,
    actionIndex: number
  ) {
    const msg = messages[msgIndex];
    const action = msg?.proposedActions?.[actionIndex];
    if (!action || action.status !== "pending") return;

    setMessages((prev) =>
      prev.map((m, i) =>
        i === msgIndex
          ? {
              ...m,
              proposedActions: m.proposedActions?.map((a, j) =>
                j === actionIndex
                  ? { ...a, status: "executing" as const }
                  : a
              ),
            }
          : m
      )
    );

    try {
      await executeActions([{ type: action.type, data: action.data }]);

      const updatedMessages = messages.map((m, i) =>
        i === msgIndex
          ? {
              ...m,
              proposedActions: m.proposedActions?.map((a, j) =>
                j === actionIndex
                  ? { ...a, status: "approved" as const }
                  : a
              ),
            }
          : m
      );
      setMessages(updatedMessages);

      // Persist
      const updatedMsg = updatedMessages[msgIndex];
      if (updatedMsg.proposedActions) {
        persistActionStatus(updatedMsg.dbId, updatedMsg.proposedActions);
      }

      router.refresh();
    } catch (err) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIndex
            ? {
                ...m,
                proposedActions: m.proposedActions?.map((a, j) =>
                  j === actionIndex
                    ? {
                        ...a,
                        status: "error" as const,
                        error:
                          err instanceof Error ? err.message : "Failed",
                      }
                    : a
                ),
              }
            : m
        )
      );
    }
  }

  // Mark email as processed
  async function handleMarkProcessed() {
    const result = await markEmailProcessed(email.id);
    if (result.success) {
      setProcessed(true);
      router.refresh();
    }
  }

  // Open attachment preview
  async function handleAttachmentClick(att: StoredEmail["attachments"][0]) {
    if (!att.storage_path) return;

    setPreviewFilename(att.filename);
    setPreviewMimeType(att.mimeType);

    const supabase = createClient();
    const { data } = await supabase.storage
      .from("email-attachments")
      .createSignedUrl(att.storage_path, 3600);

    if (data?.signedUrl) {
      if (att.mimeType?.includes("pdf") || att.mimeType?.startsWith("image/")) {
        setPreviewUrl(data.signedUrl);
      } else {
        window.open(data.signedUrl, "_blank");
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left: Email content */}
      <div className="flex-1 flex flex-col min-w-0 border-r">
        <div className="p-4 border-b space-y-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild className="shrink-0">
              <Link href="/command-center/emails">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h2 className="font-semibold text-base truncate flex-1">
              {email.subject}
            </h2>
            {processed && (
              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
            )}
            <div
              className={`p-1 rounded shrink-0 ${email.direction === "inbound" ? "bg-blue-500/20" : "bg-green-500/20"}`}
            >
              {email.direction === "inbound" ? (
                <ArrowDownLeft className="h-3.5 w-3.5 text-blue-400" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5 text-green-400" />
              )}
            </div>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5 ml-10">
            <p>
              <span className="font-medium">From:</span> {email.from_name}{" "}
              &lt;{email.from_email}&gt;
            </p>
            <p>
              <span className="font-medium">To:</span> {email.to_name} &lt;
              {email.to_email}&gt;
            </p>
            <p>
              {new Date(email.date).toLocaleString("en-US", {
                dateStyle: "full",
                timeStyle: "short",
              })}
            </p>
          </div>
          {email.attachments && email.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 ml-10">
              {email.attachments.map((att, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="text-[10px] gap-1 cursor-pointer hover:bg-amber-500/20 hover:border-amber-500/30 transition-colors"
                  onClick={() => handleAttachmentClick(att)}
                >
                  {att.mimeType?.includes("pdf") ? (
                    <FileText className="h-2.5 w-2.5" />
                  ) : (
                    <Paperclip className="h-2.5 w-2.5" />
                  )}
                  {att.filename}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 ml-10">
          <div className="text-sm whitespace-pre-wrap text-muted-foreground max-w-2xl">
            {email.body || email.snippet || "No content"}
          </div>
        </div>
      </div>

      {/* Right: AI Chat */}
      <div className="w-80 lg:w-96 flex flex-col bg-muted/30 min-w-0">
        {/* Chat header */}
        <div className="p-3 border-b flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">AI Assistant</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Reading this email...
            </p>
          </div>
          {!processed && messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleMarkProcessed}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Done
            </Button>
          )}
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
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
                  className={`text-sm rounded-lg px-3 py-2 max-w-[90%] ${
                    msg.role === "user"
                      ? "bg-amber-500/20 text-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
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
                          handleApproveSingle(msgIdx, originalIdx)
                        }
                      />
                    ))}

                  {msg.proposedActions.filter(
                    (a) => a.status === "pending" && a.type !== "skip"
                  ).length > 1 && (
                    <Button
                      size="sm"
                      className="w-full bg-amber-600 hover:bg-amber-700 text-white text-xs"
                      onClick={() => handleApproveAll(msgIdx)}
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

        {/* Suggestions (show after auto-analyze completes, if no actions approved yet) */}
        {messages.length > 0 &&
          !loading &&
          messages.every(
            (m) =>
              !m.proposedActions?.some((a) => a.status === "approved")
          ) && (
            <div className="px-3 pb-1 flex flex-wrap gap-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-[10px] px-2 py-1 rounded-full bg-muted hover:bg-amber-500/10 hover:text-amber-500 text-muted-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

        {/* Chat input */}
        <div className="p-3 border-t">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell me what to do..."
              disabled={loading}
              className="text-sm"
            />
            <Button
              onClick={() => handleSend()}
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
        </div>
      </div>

      {/* Attachment Preview Dialog */}
      <Dialog
        open={!!previewUrl}
        onOpenChange={(open) => !open && setPreviewUrl(null)}
      >
        <DialogContent
          className="max-w-4xl h-[85vh] flex flex-col p-0"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm font-medium truncate">
              {previewFilename}
            </DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => window.open(previewUrl!, "_blank")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                <a href={previewUrl!} download={previewFilename}>
                  <Download className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-4 pb-4">
            {previewMimeType?.includes("pdf") ? (
              <iframe
                src={previewUrl!}
                className="w-full h-full rounded border"
                title={previewFilename}
              />
            ) : previewMimeType?.startsWith("image/") ? (
              <img
                src={previewUrl!}
                alt={previewFilename}
                className="max-w-full max-h-full object-contain mx-auto"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
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
          {d.to_name ? <span>To: {String(d.to_name)}</span> : null}
          {d.subject ? (
            <span className="block">Re: {String(d.subject)}</span>
          ) : null}
        </>
      );

    default:
      return null;
  }
}
