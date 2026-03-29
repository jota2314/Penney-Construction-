"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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
  role: "user" | "assistant";
  content: string;
  proposedActions?: ProposedAction[];
}

interface EmailDetailProps {
  email: StoredEmail;
  projects: ProjectRef[];
}

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
  "What is this email about?",
  "Create a new project from this",
  "This is a sub quote — log it",
  "Link to an existing project",
  "Skip — not relevant",
];

export function EmailDetail({ email, projects }: EmailDetailProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [processed, setProcessed] = useState(email.is_processed);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Send message to AI
  const handleSend = useCallback(async (overrideText?: string) => {
    const text = (overrideText || input).trim();
    if (!text || loading) return;

    if (!overrideText) setInput("");
    const userMsg: DisplayMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      // Build history for Claude (just role + content)
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
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const assistantMsg: DisplayMessage = {
        role: "assistant",
        content: data.message,
        proposedActions: (data.proposed_actions || []).map(
          (a: { type: string; label: string; data: Record<string, unknown> }, i: number) => ({
            ...a,
            id: `action-${Date.now()}-${i}`,
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
          content: `Error: ${err instanceof Error ? err.message : "Failed to connect to AI"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, email.id]);

  // Execute actions
  async function executeActions(
    actions: { type: string; data: Record<string, unknown> }[]
  ) {
    const { saveApprovedDraft } = await import(
      "@/lib/actions/ai-email-engine"
    );

    // Filter to executable types (not draft_reply, skip, link_email_to_project)
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

    // Handle link_email_to_project
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

    return result;
  }

  // Link email to project by name
  async function linkEmailToProject(projectName: string) {
    const supabase = createClient();
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .ilike("name", projectName)
      .single();

    if (project) {
      await supabase
        .from("inbox_emails")
        .update({ project_id: project.id })
        .eq("id", email.id);
    }
  }

  // Approve all actions in a message
  async function handleApproveAll(msgIndex: number) {
    const msg = messages[msgIndex];
    if (!msg?.proposedActions) return;

    const pending = msg.proposedActions.filter(
      (a) => a.status === "pending" && a.type !== "skip"
    );
    if (pending.length === 0) return;

    // Mark all as executing
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

      // Mark all as approved or error
      const hasErrors = result.errors.length > 0;
      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIndex
            ? {
                ...m,
                proposedActions: m.proposedActions?.map((a) =>
                  a.status === "executing"
                    ? {
                        ...a,
                        status: hasErrors
                          ? ("error" as const)
                          : ("approved" as const),
                        error: hasErrors
                          ? result.errors.join(", ")
                          : undefined,
                      }
                    : a
                ),
              }
            : m
        )
      );

      // Add confirmation message
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

    // Mark as executing
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

      setMessages((prev) =>
        prev.map((m, i) =>
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
        )
      );

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
    const supabase = createClient();
    await supabase
      .from("inbox_emails")
      .update({ is_processed: true })
      .eq("id", email.id);
    setProcessed(true);
    router.refresh();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left: Email content */}
      <div className="flex-1 flex flex-col min-w-0 border-r">
        {/* Email header */}
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
          {/* Attachments */}
          {email.attachments && email.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 ml-10">
              {email.attachments.map((att, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="text-[10px] gap-1 cursor-pointer hover:bg-muted"
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

        {/* Email body */}
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
              Tell me what to do with this email
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
          {messages.length === 0 && (
            <div className="text-center py-6 space-y-3">
              <Bot className="h-8 w-8 text-amber-500/30 mx-auto" />
              <p className="text-xs text-muted-foreground">
                What should I do with this email?
              </p>
              <div className="space-y-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSend(suggestion)}
                    className="block w-full text-left text-xs px-3 py-2 rounded-lg bg-muted hover:bg-amber-500/10 hover:text-amber-500 text-muted-foreground transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
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
                    .filter((a) => a.type !== "skip")
                    .map((action, actionIdx) => (
                      <ActionCard
                        key={action.id}
                        action={action}
                        onApprove={() =>
                          handleApproveSingle(msgIdx, actionIdx)
                        }
                      />
                    ))}

                  {/* Approve All button */}
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

          {loading && (
            <div className="flex gap-2">
              <Bot className="h-5 w-5 text-amber-500 shrink-0" />
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

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
    </div>
  );
}

// ── Action Card Component ──────────────────────────────────────────

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
            className="text-[10px] h-6 px-2 shrink-0"
            onClick={onApprove}
          >
            Approve
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

      {/* Action details */}
      <div className="text-[10px] text-muted-foreground ml-7 space-y-0.5">
        {formatActionDetails(action)}
      </div>

      {/* Error message */}
      {action.status === "error" && action.error ? (
        <p className="text-[10px] text-red-400 ml-7">{action.error}</p>
      ) : null}

      {/* Draft reply body */}
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
          {d.status ? <span className="capitalize">{String(d.status)}</span> : null}
          {d.project_type ? <>{" "}&middot; {String(d.project_type)}</> : null}
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
          {d.project_name ? <span>Project: {String(d.project_name)}</span> : null}
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
          {d.project_name ? <span>For: {String(d.project_name)}</span> : null}
          {d.trade ? <>{" "}&middot; {String(d.trade)}</> : null}
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
            <span className="block capitalize">Priority: {String(d.priority)}</span>
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
