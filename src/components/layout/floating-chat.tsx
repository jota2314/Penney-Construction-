"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { AIChatPanel, AIChatTrigger } from "@/components/command-center/ai-chat-panel";
import { createClient } from "@/lib/supabase/client";

/**
 * Floating AI chat bubble — visible on every page.
 * Auto-detects the current project from the URL and passes context to the AI.
 */
export function FloatingChat() {
  const [chatOpen, setChatOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | undefined>();
  const [projectName, setProjectName] = useState<string | undefined>();
  const [initialMessage, setInitialMessage] = useState<string | undefined>();
  const pathname = usePathname();

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

  // Reset the seed message after the panel closes so the next open starts fresh.
  useEffect(() => {
    if (!chatOpen && initialMessage) {
      const t = setTimeout(() => setInitialMessage(undefined), 400);
      return () => clearTimeout(t);
    }
  }, [chatOpen, initialMessage]);

  // Detect project from URL: /projects/[id] or /projects/[id]/...
  useEffect(() => {
    const match = pathname.match(/\/projects\/([a-f0-9-]{36})/);
    if (match) {
      const id = match[1];
      if (id !== projectId) {
        setProjectId(id);
        // Fetch project name
        const supabase = createClient();
        supabase
          .from("projects")
          .select("name, project_number")
          .eq("id", id)
          .single()
          .then(({ data }) => {
            if (data) setProjectName(`${data.project_number} — ${data.name}`);
          });
      }
    } else {
      setProjectId(undefined);
      setProjectName(undefined);
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide on email triage pages — they have their own chat panel embedded
  // (both the dedicated /email/[id] page and the inbox right pane).
  const isEmailDetailPage = /\/command-center\/email\//.test(pathname);
  const isEmailsInbox = pathname === "/command-center/emails";
  if (isEmailDetailPage || isEmailsInbox) return null;

  return (
    <>
      <AIChatPanel
        open={chatOpen}
        onOpenChange={setChatOpen}
        projectId={projectId}
        projectName={projectName}
        initialMessage={initialMessage}
      />
      {!chatOpen && <AIChatTrigger onClick={() => setChatOpen(true)} />}
    </>
  );
}
