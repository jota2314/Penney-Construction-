"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  markEmailProcessed,
  linkEmailToProject as serverLinkEmail,
  sendEmailReply,
  downloadAttachmentsForEmail,
} from "@/lib/actions/email-actions";
import { saveApprovedDraft } from "@/lib/actions/ai-email-engine";
import { recordActionOutcome } from "@/lib/ai/memory";
import { EmailContent } from "@/components/command-center/email-content";
import { EmailChatPanel } from "@/components/command-center/email-chat-panel";
import { EmailDraftEditor } from "@/components/command-center/email-draft-editor";
import {
  QuickReplySheet,
  type QuickReplyDraft,
} from "@/components/command-center/quick-reply-sheet";
import { UndoSnackbar } from "@/components/command-center/undo-snackbar";
import type {
  EmailDetailProps,
  DisplayMessage,
  ProposedAction,
  DraftState,
  DraftAttachment,
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
  matchedNames,
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
  const [emailCollapsed, setEmailCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoAnalyzed = useRef(false);
  const router = useRouter();

  // ── Quick Reply state ───────────────────────────────────────
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [quickReplyDraft, setQuickReplyDraft] =
    useState<QuickReplyDraft | null>(null);
  const [quickReplyLoading, setQuickReplyLoading] = useState(false);
  const [pendingSend, setPendingSend] = useState<QuickReplyDraft | null>(null);

  // ── Classifier backfill state (for emails missing ai_classified_at) ─
  const [classifying, setClassifying] = useState(false);
  // Local mirror of the email's classified-at timestamp so the summary card
  // re-renders once backfill finishes (the email prop comes from the server).
  const [classifiedEmail, setClassifiedEmail] = useState(email);

  async function handleClassifyNow() {
    if (classifying || classifiedEmail.ai_classified_at) return;
    setClassifying(true);
    try {
      const res = await fetch("/api/email/classify-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: email.id }),
      });
      const data = await res.json();
      if (res.ok && data.result) {
        setClassifiedEmail((prev) => ({
          ...prev,
          ai_classified_at: new Date().toISOString(),
          sender_type: data.result.sender_type ?? prev.sender_type,
          urgency: data.result.urgency ?? prev.urgency,
          ai_summary: data.result.summary ?? prev.ai_summary,
          ai_action_required:
            data.result.action_required ?? prev.ai_action_required,
          content_type: data.result.content_type ?? prev.content_type,
          matched_customer_id:
            data.result.matched_customer_id ?? prev.matched_customer_id,
          matched_subcontractor_id:
            data.result.matched_subcontractor_id ??
            prev.matched_subcontractor_id,
          matched_project_id:
            data.result.matched_project_id ?? prev.matched_project_id,
        }));
      }
    } catch {
      // Silent fail — user can still tap "Read Email" for the full Sonnet flow
    } finally {
      setClassifying(false);
    }
  }

  async function fetchQuickReplyDraft(regenerateHint?: string) {
    setQuickReplyLoading(true);
    try {
      const res = await fetch("/api/email-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId: email.id,
          intent: "draft_reply_only",
          userName,
          regenerateHint,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const action = (data.proposed_actions || []).find(
        (a: { type: string }) => a.type === "draft_reply"
      );
      if (action) {
        const d = action.data as Record<string, string>;
        setQuickReplyDraft({
          to_email: d.to_email || email.from_email,
          to_name: d.to_name || email.from_name || "",
          subject:
            d.subject ||
            (email.subject.startsWith("Re:")
              ? email.subject
              : `Re: ${email.subject}`),
          body: d.body || "",
        });
      }
    } catch (err) {
      setQuickReplyDraft({
        to_email: email.from_email,
        to_name: email.from_name || "",
        subject: email.subject.startsWith("Re:")
          ? email.subject
          : `Re: ${email.subject}`,
        body: `Could not draft reply: ${err instanceof Error ? err.message : "Unknown error"}\n\nTry again or write your own.`,
      });
    } finally {
      setQuickReplyLoading(false);
    }
  }

  function handleOpenQuickReply() {
    setQuickReplyOpen(true);
    setQuickReplyDraft(null);
    fetchQuickReplyDraft();
  }

  function handleQuickReplySend(finalDraft: QuickReplyDraft) {
    // Close the sheet and start the 3-second undo window
    setQuickReplyOpen(false);
    setPendingSend(finalDraft);
  }

  async function commitPendingSend() {
    const draft = pendingSend;
    if (!draft) return;
    setPendingSend(null);

    const isReplyToSender =
      draft.to_email.toLowerCase() === email.from_email.toLowerCase();

    const result = await sendEmailReply({
      to: draft.to_email,
      subject: draft.subject,
      body: draft.body,
      threadId: isReplyToSender ? email.thread_id || undefined : undefined,
      inReplyTo: isReplyToSender
        ? email.gmail_message_id || undefined
        : undefined,
    });

    if (!result.success) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Quick Reply failed: ${result.error || "send error"}`,
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Quick Reply sent to ${draft.to_email}.`,
        },
      ]);
    }
    router.refresh();
  }

  function undoPendingSend() {
    setPendingSend(null);
    // Reopen the sheet so user can edit/regenerate
    setQuickReplyOpen(true);
  }

  // Load existing conversation (no auto-analyze — user triggers manually)
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
      // Append rather than replace — replacing wipes any prior conversation
      // loaded from the DB, which is a major source of perceived context loss.
      setMessages((prev) => [...prev, assistantMsg]);
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
    async (overrideText?: string, chatAttachments?: Array<{ type: string; filename: string; mimeType: string; storagePath?: string }>) => {
      const text = (overrideText || input).trim();
      if (!text && (!chatAttachments || chatAttachments.length === 0)) return;
      if (loading) return;

      if (!overrideText) setInput("");
      const userMsg: DisplayMessage = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const history = messages.map((m) => {
          let content = m.content;
          // Include already-proposed actions so AI doesn't re-propose them
          if (m.proposedActions && m.proposedActions.length > 0) {
            const actionSummary = m.proposedActions
              .map((a) => `[${a.status.toUpperCase()}] ${a.type}: ${a.label}`)
              .join("\n");
            content += `\n\n[ACTIONS ALREADY PROPOSED — DO NOT RE-PROPOSE THESE:\n${actionSummary}]`;
          }
          return { role: m.role, content };
        });

        // Include current draft context if user is editing one
        const requestBody: Record<string, unknown> = {
          emailId: email.id,
          messages: history,
          userMessage: text || "[attached document]",
          conversationId,
          userName,
          attachments: chatAttachments || [],
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
    // Accept both draft_reply (triage's native type) and draft_email
    // (the AI sometimes emits the shared-tools name instead).
    if (!action || (action.type !== "draft_reply" && action.type !== "draft_email")) return;

    // Build initial attachments from AI suggestion if provided
    const suggestedPaths = (action.data.attachment_paths as string[]) || [];
    const initialAttachments: DraftAttachment[] = suggestedPaths
      .map((path) => {
        // Check original email attachments first
        const att = email.attachments?.find((a) => a.storage_path === path);
        if (att && att.storage_path) {
          return { filename: att.filename, mimeType: att.mimeType, storagePath: att.storage_path, size: att.size };
        }
        // If not found in email, it might be a chat-uploaded file — include it directly
        if (path) {
          const filename = path.split("/").pop() || "attachment";
          return { filename, mimeType: "application/octet-stream", storagePath: path };
        }
        return null;
      })
      .filter((a): a is DraftAttachment => a !== null);

    setActiveDraft({
      sourceActionId: action.id,
      sourceMsgIndex: msgIndex,
      sourceActionIndex: actionIndex,
      // draft_reply uses to_email; draft_email uses to. Accept both.
      to: (action.data.to_email as string) || (action.data.to as string) || email.from_email,
      toName: (action.data.to_name as string) || "",
      cc: (action.data.cc as string) || "",
      subject: (action.data.subject as string) || `Re: ${email.subject}`,
      body: (action.data.body as string) || "",
      attachments: initialAttachments,
    });
  }

  function handleUpdateDraftField(field: keyof DraftState, value: string) {
    setActiveDraft((prev) => (prev ? { ...prev, [field]: value } : null));
  }

  function handleAddAttachment(att: DraftAttachment) {
    setActiveDraft((prev) =>
      prev ? { ...prev, attachments: [...prev.attachments, att] } : null
    );
  }

  function handleRemoveAttachment(index: number) {
    setActiveDraft((prev) =>
      prev
        ? { ...prev, attachments: prev.attachments.filter((_, i) => i !== index) }
        : null
    );
  }

  async function handleSendDraft() {
    if (!activeDraft) return;
    setSending(true);

    try {
      const toEmail = activeDraft.to;
      const isReplyToSender = toEmail.toLowerCase() === email.from_email.toLowerCase();

      // Build attachments: local uploads already have content, Supabase files need downloading
      let emailAttachments: { filename: string; mimeType: string; content: string }[] | undefined;
      if (activeDraft.attachments.length > 0) {
        const localFiles = activeDraft.attachments
          .filter((a) => a.content)
          .map((a) => ({ filename: a.filename, mimeType: a.mimeType, content: a.content! }));
        const supabaseFiles = activeDraft.attachments.filter(
          (a) => !a.content && !a.storagePath.startsWith("local://")
        );
        const downloadedFiles = supabaseFiles.length > 0
          ? await downloadAttachmentsForEmail(
              supabaseFiles.map((a) => ({
                storagePath: a.storagePath,
                filename: a.filename,
                mimeType: a.mimeType,
              }))
            )
          : [];
        emailAttachments = [...localFiles, ...downloadedFiles];
        if (emailAttachments.length === 0) emailAttachments = undefined;
      }

      const sendResult = await sendEmailReply({
        to: toEmail,
        subject: activeDraft.subject,
        body: activeDraft.body,
        cc: activeDraft.cc || undefined,
        threadId: isReplyToSender ? (email.thread_id || undefined) : undefined,
        inReplyTo: isReplyToSender ? (email.gmail_message_id || undefined) : undefined,
        attachments: emailAttachments,
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
      emailsProcessed: 0,
      projectsCreated: 0,
      customersCreated: 0,
      subsCreated: 0,
      quotesCreated: 0,
      invoicesCreated: 0,
      todosCreated: 0,
      eventsScheduled: 0,
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

      // Record outcomes for all approved actions (fire-and-forget)
      for (const a of pending) {
        recordActionOutcome(
          a.type, a.label, a.data, a.data, "approved",
          email.gmail_message_id, conversationId || undefined,
        ).catch(() => {});
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
      if (result.todosCreated > 0)
        parts.push(`${result.todosCreated} todo(s)`);
      if (result.eventsScheduled > 0)
        parts.push(`${result.eventsScheduled} event(s) scheduled`);
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
    actionIndex: number,
    editedData?: Record<string, unknown>
  ) {
    const msg = messages[msgIndex];
    const action = msg?.proposedActions?.[actionIndex];
    if (!action || action.status !== "pending") return;

    // Use edited data if provided, otherwise use original
    const dataToSave = editedData || action.data;

    // Update the action data in state if it was edited
    setMessages((prev) =>
      prev.map((m, i) =>
        i === msgIndex
          ? {
              ...m,
              proposedActions: m.proposedActions?.map((a, j) =>
                j === actionIndex
                  ? { ...a, data: dataToSave, status: "executing" as const }
                  : a
              ),
            }
          : m
      )
    );

    try {
      const result = await executeActions([{ type: action.type, data: dataToSave }]);
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

      // Record action outcome for AI learning (fire-and-forget)
      const wasEdited = editedData && JSON.stringify(editedData) !== JSON.stringify(action.data);
      recordActionOutcome(
        action.type,
        action.label,
        action.data,
        dataToSave,
        wasEdited ? "approved_with_edits" : "approved",
        email.gmail_message_id,
        conversationId || undefined,
      ).catch(() => {}); // non-blocking

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
    <>
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
        {/* Left panel: Email content */}
        <EmailContent
          email={email}
          projects={projects}
          processed={processed}
          backUrl={backUrl}
          onSendChat={handleSend}
          onReply={handleOpenQuickReply}
          router={router}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          collapsed={emailCollapsed}
          onToggleCollapse={() => {
            if (emailCollapsed) {
              // Expanding email — go back to split view
              setEmailCollapsed(false);
              setChatCollapsed(false);
            } else {
              // Collapsing email — chat takes full space
              setEmailCollapsed(true);
              setChatCollapsed(false);
            }
          }}
          otherCollapsed={chatCollapsed}
          onShowOther={() => {
            setChatCollapsed(false);
          }}
        />

        {/* Right panel: AI Chat */}
        <EmailChatPanel
          email={classifiedEmail}
          matchedNames={matchedNames}
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
          onReadEmail={fireAutoAnalyze}
          onQuickReply={handleOpenQuickReply}
          onClassifyNow={handleClassifyNow}
          classifying={classifying}
          inputRef={inputRef}
          activeDraft={activeDraft}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          collapsed={chatCollapsed}
          onToggleCollapse={() => {
            if (chatCollapsed) {
              // Expanding chat — go back to split view
              setChatCollapsed(false);
              setEmailCollapsed(false);
            } else {
              // Collapsing chat — email takes full space
              setChatCollapsed(true);
              setEmailCollapsed(false);
            }
          }}
          otherCollapsed={emailCollapsed}
          onShowOther={() => {
            setEmailCollapsed(false);
          }}
        />
      </div>

      {/* Draft editor popup */}
      {activeDraft && (
        <EmailDraftEditor
          open
          draft={activeDraft}
          originalEmail={email}
          onUpdateField={handleUpdateDraftField}
          onAddAttachment={handleAddAttachment}
          onRemoveAttachment={handleRemoveAttachment}
          onSend={handleSendDraft}
          onDiscard={handleDiscardDraft}
          sending={sending}
        />
      )}

      {/* Quick Reply bottom sheet — AI draft + Send/Edit/Regenerate */}
      <QuickReplySheet
        open={quickReplyOpen}
        onClose={() => setQuickReplyOpen(false)}
        draft={quickReplyDraft}
        loading={quickReplyLoading}
        onRegenerate={(hint) => fetchQuickReplyDraft(hint)}
        onSend={handleQuickReplySend}
      />

      {/* 3-second undo before actually pushing to Gmail */}
      <UndoSnackbar
        open={!!pendingSend}
        message={`Sending to ${pendingSend?.to_name || pendingSend?.to_email || ""}`}
        durationMs={3000}
        onCommit={commitPendingSend}
        onUndo={undoPendingSend}
      />
    </>
  );
}
