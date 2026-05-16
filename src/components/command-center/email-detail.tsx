"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  markEmailProcessed,
  sendEmailReply,
  downloadAttachmentsForEmail,
} from "@/lib/actions/email-actions";
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

// Auto-analyze prompt sent through /api/chat the moment the email is opened.
// This is the same aggressive triage prompt the old "Deep analysis" button
// used to fire — but now it fires automatically so the user lands on a
// fully-analyzed email with proposed actions ready to approve (link to
// project, save attachments, draft reply, etc.).
const AUTO_ANALYZE_PROMPT = `Analyze this email and DO EVERYTHING it needs — don't just describe it, take action. For every email:
1. Create/link the project if it's a real job
2. Create customers and subs from the email — but CHECK THE EXISTING DATABASE FIRST. If a person already exists (even under a slightly different name or company), do NOT create a duplicate.
3. Save any quotes, invoices, or files attached
4. Create todos for any follow-up work needed
5. Do NOT auto-draft a reply. Instead, at the end of your message, ASK the user: "Would you like me to draft a reply?" Only draft if they say yes.
6. If it's spam, newsletter, or truly irrelevant → skip

We're in setup mode — building the company database from historical emails. Be aggressive about creating projects and extracting data. Propose ALL actions at once so the user just clicks approve.`;

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

  // Load existing conversation if there's a prior thread on this email.
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

  // Auto-fire deep analysis on email open: streams AUTO_ANALYZE_PROMPT
  // through /api/chat with emailId injected. The unified chat pulls in
  // email body + attachment text + thread metadata server-side, so this
  // single call covers reading attachments, linking to project, proposing
  // quote/customer/sub/todo actions, etc. — everything the old "Deep
  // analysis" button used to do, but without the click.
  const fireAutoAnalyze = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: AUTO_ANALYZE_PROMPT,
          conversationId,
          emailId: email.id,
          source: "auto_analyze_prompt",
        }),
      });

      if (!res.ok) throw new Error(`Chat API error: ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      const collectedActions: ProposedAction[] = [];
      let receivedConvId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const ev = JSON.parse(jsonStr);
            if (ev.type === "conversation_id") receivedConvId = ev.id;
            else if (ev.type === "text") fullContent += ev.content || "";
            else if (ev.type === "proposed_action") {
              collectedActions.push({
                id: ev.action_id || `auto-${Date.now()}-${collectedActions.length}`,
                type: ev.action_type,
                label: ev.label || ev.action_type,
                data: ev.data || {},
                status: "pending",
              });
            } else if (ev.type === "done") {
              if (ev.conversationId) receivedConvId = ev.conversationId;
            } else if (ev.type === "error") {
              throw new Error(ev.message || "Stream error");
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      if (receivedConvId) setConversationId(receivedConvId);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: fullContent,
          proposedActions:
            collectedActions.length > 0 ? collectedActions : undefined,
        },
      ]);
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
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [conversationId, email.id]);

  // Fire deep analysis automatically on mount when there's no prior
  // conversation. Guarded by a ref so it never double-fires (StrictMode,
  // re-renders, etc.).
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (existingConversation?.messages.length) return;
    autoFiredRef.current = true;
    fireAutoAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Send user message — streams from /api/chat with emailId injected.
  // Phase 2 of unified chat: typed messages and Read-Email both flow
  // through the main chat now. Action approvals route to
  // /api/chat/execute-action (Claude tool input shape) instead of the
  // legacy saveApprovedDraft path.
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
        // When the user is refining an open draft, prepend the current
        // draft so /api/chat sees what they're editing — the unified
        // chat doesn't have a dedicated currentDraft parameter.
        let messageForChat = text || "[attached document]";
        if (activeDraft) {
          const draftBlock = `[I'm editing this draft. Update it via draft_email. Current draft:
To: ${activeDraft.to}
${activeDraft.cc ? `CC: ${activeDraft.cc}\n` : ""}Subject: ${activeDraft.subject}
Body:
${activeDraft.body}]

`;
          messageForChat = draftBlock + (text || "Refine the draft.");
        }

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: messageForChat,
            conversationId,
            emailId: email.id,
            source: "text",
            attachments: chatAttachments || [],
          }),
        });

        if (!res.ok) throw new Error(`Chat API error: ${res.status}`);

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";
        const collectedActions: ProposedAction[] = [];
        let receivedConvId: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const ev = JSON.parse(jsonStr);
              if (ev.type === "conversation_id") {
                receivedConvId = ev.id;
              } else if (ev.type === "text") {
                fullContent += ev.content || "";
              } else if (ev.type === "proposed_action") {
                collectedActions.push({
                  id: ev.action_id || `act-${Date.now()}-${collectedActions.length}`,
                  type: ev.action_type,
                  label: ev.label || ev.action_type,
                  data: ev.data || {},
                  status: "pending",
                });
              } else if (ev.type === "done") {
                if (ev.conversationId) receivedConvId = ev.conversationId;
              } else if (ev.type === "error") {
                throw new Error(ev.message || "Stream error");
              }
              // tool_status events are noise for this UI; skip
            } catch {
              // skip malformed lines
            }
          }
        }

        if (receivedConvId) setConversationId(receivedConvId);

        // If user is editing a draft and AI returned an updated draft_email,
        // apply it directly to the editor instead of showing another card
        if (activeDraft) {
          const draftAction = collectedActions.find(
            (a) => a.type === "draft_email" || a.type === "draft_reply"
          );
          if (draftAction) {
            const d = draftAction.data as Record<string, unknown>;
            setActiveDraft((prev) =>
              prev
                ? {
                    ...prev,
                    to: ((d.to as string) || (d.to_email as string)) || prev.to,
                    cc: ((d.cc as string) ?? prev.cc),
                    subject: (d.subject as string) || prev.subject,
                    body: (d.body as string) || prev.body,
                  }
                : null
            );
            const filtered = collectedActions.filter(
              (a) => a.type !== "draft_email" && a.type !== "draft_reply"
            );
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: fullContent,
                proposedActions: filtered.length > 0 ? filtered : undefined,
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: fullContent,
                proposedActions:
                  collectedActions.length > 0 ? collectedActions : undefined,
              },
            ]);
          }
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: fullContent,
              proposedActions:
                collectedActions.length > 0 ? collectedActions : undefined,
            },
          ]);
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
    [input, loading, email.id, conversationId, activeDraft]
  );

  // ── Draft handling ─────────────────────────────────────────

  function handleOpenDraft(msgIndex: number, actionIndex: number) {
    const action = messages[msgIndex]?.proposedActions?.[actionIndex];
    // Accept both draft_reply (legacy email-chat type) and draft_email
    // (the unified chat tool name).
    if (!action || (action.type !== "draft_reply" && action.type !== "draft_email")) return;

    // Two attachment shapes in the wild:
    //   legacy: action.data.attachment_paths = ["chat-uploads/..."]
    //   new:    action.data.attachments     = [{ storage_path, filename, mimeType? }]
    const legacyPaths = (action.data.attachment_paths as string[]) || [];
    const newAttachments =
      (action.data.attachments as Array<{
        storage_path?: string;
        filename?: string;
        mimeType?: string;
      }>) || [];

    const fromLegacy = legacyPaths
      .map((path) => {
        const att = email.attachments?.find((a) => a.storage_path === path);
        if (att && att.storage_path) {
          return {
            filename: att.filename,
            mimeType: att.mimeType,
            storagePath: att.storage_path,
            size: att.size,
          };
        }
        if (path) {
          const filename = path.split("/").pop() || "attachment";
          return { filename, mimeType: "application/octet-stream", storagePath: path };
        }
        return null;
      })
      .filter((a): a is DraftAttachment => a !== null);

    const fromNew = newAttachments
      .map((a) => {
        if (!a.storage_path) return null;
        const att = email.attachments?.find((e) => e.storage_path === a.storage_path);
        return {
          filename: a.filename || att?.filename || a.storage_path.split("/").pop() || "attachment",
          mimeType: a.mimeType || att?.mimeType || "application/octet-stream",
          storagePath: a.storage_path,
          size: att?.size,
        } as DraftAttachment;
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
      attachments: [...fromLegacy, ...fromNew],
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
  //
  // Phase 2 of unified chat: every approval routes to
  // /api/chat/execute-action which calls the same executeTool() handler
  // /api/chat uses internally. No more saveApprovedDraft path — actions
  // come from real Claude tool calls and the data shape matches what
  // the tool handler expects.
  //
  // draft_reply / draft_email is intercepted upstream (handleOpenDraft
  // opens the draft editor) and therefore should never reach this fn.
  // skip is a no-op marker.

  async function executeActions(
    actions: { type: string; data: Record<string, unknown> }[]
  ) {
    const result = {
      successCount: 0,
      errors: [] as string[],
    };

    for (const action of actions) {
      // draft_reply / draft_email goes through the editor flow, not server execute.
      // skip is a UI-only marker that just dismisses the proposed action.
      if (action.type === "skip" || action.type === "draft_reply" || action.type === "draft_email") {
        result.successCount++;
        continue;
      }

      try {
        const res = await fetch("/api/chat/execute-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action_type: action.type,
            data: action.data,
          }),
        });
        const json = await res.json();
        if (!res.ok || json.error || json.success === false) {
          const msg =
            (json.error as string) ||
            `${action.type} failed (${res.status})`;
          result.errors.push(msg);
        } else {
          result.successCount++;
        }
      } catch (err) {
        result.errors.push(
          `${action.type}: ${err instanceof Error ? err.message : "request failed"}`
        );
      }
    }

    return result;
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

      const summary =
        result.successCount > 0
          ? `Done — ran ${result.successCount} action${result.successCount > 1 ? "s" : ""}.`
          : "No actions ran.";

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
