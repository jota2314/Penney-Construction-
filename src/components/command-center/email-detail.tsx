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
import { EmailDraftEditor } from "@/components/command-center/email-draft-editor";
import type {
  EmailDetailProps,
  DisplayMessage,
  ProposedAction,
  DraftState,
  ViewMode,
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
  const [activeDraft, setActiveDraft] = useState<DraftState | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoAnalyzed = useRef(false);
  const router = useRouter();

  // Load existing conversation OR auto-analyze
  useEffect(() => {
    if (autoAnalyzed.current) return;
    autoAnalyzed.current = true;

    if (existingConversation?.messages.length) {
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
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
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

  // Send user message — includes draft context if editing
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

        // Include current draft context if user is editing one
        const requestBody: Record<string, unknown> = {
          emailId: email.id,
          messages: history,
          userMessage: text,
          conversationId,
          userName,
        };
        if (activeDraft) {
          requestBody.currentDraft = {
            to: activeDraft.to,
            cc: activeDraft.cc,
            subject: activeDraft.subject,
            body: activeDraft.body,
          };
        }

        const res = await fetch("/api/email-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (data.conversationId) setConversationId(data.conversationId);

        const proposedActions = (data.proposed_actions || []).map(
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
        );

        // If user is editing a draft and AI returned an updated draft_reply,
        // apply it directly to the editor instead of showing another action card
        if (activeDraft) {
          const draftAction = proposedActions.find(
            (a: { type: string }) => a.type === "draft_reply"
          );
          if (draftAction) {
            setActiveDraft((prev) =>
              prev
                ? {
                    ...prev,
                    to: (draftAction.data.to_email as string) || prev.to,
                    cc: (draftAction.data.cc as string) ?? prev.cc,
                    subject: (draftAction.data.subject as string) || prev.subject,
                    body: (draftAction.data.body as string) || prev.body,
                  }
                : null
            );
            // Remove draft_reply from action cards since it was applied to editor
            const filteredActions = proposedActions.filter(
              (a: { type: string }) => a.type !== "draft_reply"
            );
            const assistantMsg: DisplayMessage = {
              dbId: data.assistantMessageId || undefined,
              role: "assistant",
              content: data.message,
              proposedActions: filteredActions.length > 0 ? filteredActions : undefined,
            };
            setMessages((prev) => [...prev, assistantMsg]);
          } else {
            const assistantMsg: DisplayMessage = {
              dbId: data.assistantMessageId || undefined,
              role: "assistant",
              content: data.message,
              proposedActions: proposedActions.length > 0 ? proposedActions : undefined,
            };
            setMessages((prev) => [...prev, assistantMsg]);
          }
        } else {
          const assistantMsg: DisplayMessage = {
            dbId: data.assistantMessageId || undefined,
            role: "assistant",
            content: data.message,
            proposedActions: proposedActions.length > 0 ? proposedActions : undefined,
          };
          setMessages((prev) => [...prev, assistantMsg]);
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
    },
    [input, loading, messages, email.id, conversationId, userName, activeDraft]
  );

  // ── Draft handling ─────────────────────────────────────────

  function handleOpenDraft(msgIndex: number, actionIndex: number) {
    const action = messages[msgIndex]?.proposedActions?.[actionIndex];
    if (!action || action.type !== "draft_reply") return;

    setActiveDraft({
      sourceActionId: action.id,
      sourceMsgIndex: msgIndex,
      sourceActionIndex: actionIndex,
      to: (action.data.to_email as string) || email.from_email,
      toName: (action.data.to_name as string) || "",
      cc: (action.data.cc as string) || "",
      subject: (action.data.subject as string) || `Re: ${email.subject}`,
      body: (action.data.body as string) || "",
    });

    // On mobile, switch to email view to show the editor
    if (window.innerWidth < 768) {
      setViewMode("email");
    }
  }

  function handleUpdateDraftField(field: keyof DraftState, value: string) {
    setActiveDraft((prev) => (prev ? { ...prev, [field]: value } : null));
  }

  async function handleSendDraft() {
    if (!activeDraft) return;
    setSending(true);

    try {
      const toEmail = activeDraft.to;
      const isReplyToSender = toEmail.toLowerCase() === email.from_email.toLowerCase();

      const sendResult = await sendEmailReply({
        to: toEmail,
        subject: activeDraft.subject,
        body: activeDraft.body,
        replyTo: email.from_email,
        cc: activeDraft.cc || undefined,
        threadId: isReplyToSender ? (email.thread_id || undefined) : undefined,
        inReplyTo: isReplyToSender ? (email.gmail_message_id || undefined) : undefined,
      });

      if (!sendResult.success) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error sending email: ${sendResult.error}` },
        ]);
        return;
      }

      // Mark the source action as approved
      setMessages((prev) =>
        prev.map((m, i) =>
          i === activeDraft.sourceMsgIndex
            ? {
                ...m,
                proposedActions: m.proposedActions?.map((a, j) =>
                  j === activeDraft.sourceActionIndex
                    ? { ...a, status: "approved" as const }
                    : a
                ),
              }
            : m
        )
      );

      // Persist status
      const msg = messages[activeDraft.sourceMsgIndex];
      if (msg?.proposedActions) {
        const updatedActions = msg.proposedActions.map((a, j) =>
          j === activeDraft.sourceActionIndex
            ? { ...a, status: "approved" as const }
            : a
        );
        persistActionStatus(msg.dbId, updatedActions);
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Email sent to ${activeDraft.to}!` },
      ]);

      setActiveDraft(null);
      if (viewMode === "email") setViewMode("split");
      router.refresh();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Failed to send"}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleDiscardDraft() {
    setActiveDraft(null);
    if (viewMode === "email") setViewMode("split");
  }

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

    // Handle draft_reply — send via Gmail
    const replyActions = actions.filter((a) => a.type === "draft_reply");
    for (const replyAction of replyActions) {
      const d = replyAction.data;
      const toEmail = (d.to_email as string) || email.from_email;
      const isReplyToSender = toEmail.toLowerCase() === email.from_email.toLowerCase();

      const sendResult = await sendEmailReply({
        to: toEmail,
        subject: (d.subject as string) || `Re: ${email.subject}`,
        body: (d.body as string) || "",
        replyTo: email.from_email,
        cc: (d.cc as string) || undefined,
        threadId: isReplyToSender ? (email.thread_id || undefined) : undefined,
        inReplyTo: isReplyToSender ? (email.gmail_message_id || undefined) : undefined,
      });
      if (!sendResult.success) {
        result.errors.push(sendResult.error || `Failed to send email to ${toEmail}`);
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

      const updatedMsg = updatedMessages[msgIndex];
      if (updatedMsg.proposedActions) {
        persistActionStatus(updatedMsg.dbId, updatedMsg.proposedActions);
      }

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
      const result = await executeActions([{ type: action.type, data: action.data }]);
      const hasErrors = result.errors.length > 0;

      const updatedMessages = messages.map((m, i) =>
        i === msgIndex
          ? {
              ...m,
              proposedActions: m.proposedActions?.map((a, j) =>
                j === actionIndex
                  ? {
                      ...a,
                      status: (hasErrors ? "error" : "approved") as ProposedAction["status"],
                      error: hasErrors ? result.errors.join(", ") : undefined,
                    }
                  : a
              ),
            }
          : m
      );
      setMessages(updatedMessages);

      const updatedMsg = updatedMessages[msgIndex];
      if (updatedMsg.proposedActions) {
        persistActionStatus(updatedMsg.dbId, updatedMsg.proposedActions);
      }

      if (hasErrors) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${result.errors.join(", ")}` },
        ]);
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
      {/* Left panel: Email content OR Draft editor */}
      {viewMode !== "chat" && (
        activeDraft ? (
          <div className={`${viewMode === "email" ? "flex-1" : "md:flex-1"} flex flex-col min-w-0 min-h-0 md:border-r`}>
            <EmailDraftEditor
              draft={activeDraft}
              originalEmail={email}
              onUpdateField={handleUpdateDraftField}
              onSend={handleSendDraft}
              onDiscard={handleDiscardDraft}
              sending={sending}
            />
          </div>
        ) : (
          <EmailContent
            email={email}
            projects={projects}
            processed={processed}
            backUrl={backUrl}
            onSendChat={handleSend}
            router={router}
          />
        )
      )}

      {/* Right panel: AI Chat */}
      {viewMode !== "email" && (
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
          onOpenDraft={handleOpenDraft}
          inputRef={inputRef}
          activeDraft={activeDraft}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      )}
    </div>
  );
}
