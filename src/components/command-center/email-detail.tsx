"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  markEmailProcessed,
  linkEmailToProject as serverLinkEmail,
  sendEmailReply,
} from "@/lib/actions/email-actions";
import { saveApprovedDraft } from "@/lib/actions/ai-email-engine";
import { EmailContent } from "@/components/command-center/email-content";
import { EmailChatPanel } from "@/components/command-center/email-chat-panel";
import type {
  EmailDetailProps,
  DisplayMessage,
  ProposedAction,
} from "@/components/command-center/email-detail-types";

// Re-export types so existing imports from this file still work
export type {
  AttachmentMeta,
  StoredEmail,
  ProjectRef,
  ProposedAction,
  DisplayMessage,
  ExistingConversation,
  EmailDetailProps,
} from "@/components/command-center/email-detail-types";

// ── Main Component ───────────────────────────────────────────────

export function EmailDetail({
  email,
  projects,
  backUrl,
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
  const inputRef = useRef<HTMLInputElement>(null);
  const autoAnalyzed = useRef(false);
  const router = useRouter();

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
    [input, loading, messages, email.id, conversationId, userName]
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
      result = await saveApprovedDraft(dbActions, email.gmail_message_id, email.date);
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

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
      <EmailContent
        email={email}
        projects={projects}
        processed={processed}
        backUrl={backUrl}
        onSendChat={handleSend}
        router={router}
      />
      <EmailChatPanel
        messages={messages}
        loading={loading}
        processed={processed}
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        onMarkProcessed={handleMarkProcessed}
        onApproveAll={handleApproveAll}
        onApproveSingle={handleApproveSingle}
        inputRef={inputRef}
      />
    </div>
  );
}
