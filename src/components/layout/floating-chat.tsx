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
  const pathname = usePathname();

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

  // Hide on email triage pages — they have their own chat panel
  const isEmailDetailPage = /\/command-center\/email\//.test(pathname);
  if (isEmailDetailPage) return null;

  return (
    <>
      <AIChatPanel
        open={chatOpen}
        onOpenChange={setChatOpen}
        projectId={projectId}
        projectName={projectName}
      />
      {!chatOpen && <AIChatTrigger onClick={() => setChatOpen(true)} />}
    </>
  );
}
