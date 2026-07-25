"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { AIChatTrigger } from "@/components/command-center/ai-chat-trigger";
import { createClient } from "@/lib/supabase/client";

// This component mounts on EVERY page via (app)/layout.tsx. Loading the chat
// panel eagerly put ~850 lines of component code (plus ChatInput, ChatMessage,
// Sheet and EmailAutocomplete) into the critical hydration path of every
// navigation, for a panel that is closed almost all of the time.
const AIChatPanel = dynamic(
  () => import("@/components/command-center/ai-chat-panel").then((m) => m.AIChatPanel),
  { ssr: false }
);

/**
 * Floating AI chat bubble — visible on every page.
 * Auto-detects the current project from the URL and passes context to the AI.
 */
export function FloatingChat() {
  const [chatOpen, setChatOpen] = useState(false);
  // Mount the panel on first open and keep it mounted afterwards, so the
  // chunk is never fetched until the user actually wants the chat, but the
  // conversation still survives closing and reopening it.
  const [hasOpened, setHasOpened] = useState(false);
  const [projectName, setProjectName] = useState<string | undefined>();
  const [initialMessage, setInitialMessage] = useState<string | undefined>();
  const pathname = usePathname();
  const projectId = pathname.match(/\/projects\/([a-f0-9-]{36})/)?.[1];

  // External components (e.g. the email swipe card on /command-center) can
  // open the chat pre-loaded against a specific email by dispatching:
  //   window.dispatchEvent(new CustomEvent("open-ai-chat", {
  //     detail: { emailId, subject }
  //   }))
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { emailId?: string; subject?: string; message?: string } | undefined;
      if (detail?.emailId) {
        const subj = detail.subject ? ` (subject: "${detail.subject}")` : "";
        setInitialMessage(
          `Open email ${detail.emailId}${subj} with get_email_details and help me act on it — summarize, suggest a reply, or extract action items as appropriate.`,
        );
      } else if (detail?.message) {
        setInitialMessage(detail.message);
      }
      setChatOpen(true);
    };
    window.addEventListener("open-ai-chat", handler);
    return () => window.removeEventListener("open-ai-chat", handler);
  }, []);

  // Latch the panel into the tree the first time it opens.
  useEffect(() => {
    if (chatOpen) setHasOpened(true);
  }, [chatOpen]);

  // Reset the seed message after the panel closes so the next open starts fresh.
  useEffect(() => {
    if (!chatOpen && initialMessage) {
      const t = setTimeout(() => setInitialMessage(undefined), 400);
      return () => clearTimeout(t);
    }
  }, [chatOpen, initialMessage]);

  // Detect project from URL: /projects/[id] or /projects/[id]/...
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("projects")
      .select("name, project_number")
      .eq("id", projectId)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) {
          setProjectName(`${data.project_number} — ${data.name}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Hide on email triage pages — they have their own chat panel embedded
  // (both the dedicated /email/[id] page and the inbox right pane).
  const isEmailDetailPage = /\/command-center\/email\//.test(pathname);
  const isEmailsInbox = pathname === "/command-center/emails";
  if (isEmailDetailPage) return null;

  return (
    <>
      {hasOpened && (
        <AIChatPanel
          open={chatOpen}
          onOpenChange={setChatOpen}
          projectId={projectId}
          projectName={projectId ? projectName : undefined}
          initialMessage={initialMessage}
        />
      )}
      {!chatOpen && !isEmailsInbox && (
        <AIChatTrigger onClick={() => setChatOpen(true)} />
      )}
    </>
  );
}
