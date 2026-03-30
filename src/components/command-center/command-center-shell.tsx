"use client";

import { useState, useCallback } from "react";
import { ActionInbox } from "./action-inbox";
import { ProjectStatusBoard } from "./project-status-board";
import { CrewDeployment } from "./crew-deployment";
import { AIChatPanel, AIChatTrigger } from "./ai-chat-panel";

interface ChatContext {
  projectId?: string;
  projectName?: string;
  message?: string;
}

interface CommandCenterShellProps {
  actionInbox: {
    todos: Array<{
      id: string;
      contact_name: string;
      contact_type: string;
      description: string;
      priority: string;
      project_name: string | null;
      project_id: string | null;
      due_date: string | null;
      type: "todo";
      isOverdue: boolean;
    }>;
    quotes: Array<{
      id: string;
      subcontractor_name: string;
      project_name: string | null;
      project_id: string | null;
      trade: string | null;
      amount: number | null;
      status: string;
      type: "quote_review";
    }>;
    emails: Array<{
      id: string;
      subject: string;
      from_name: string | null;
      from_email: string | null;
      project_name: string | null;
      project_id: string | null;
      category: string | null;
      sent_at: string | null;
      type: "email";
    }>;
  };
  projects: Array<{
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    status: string;
    project_type: string | null;
    estimated_value: number | null;
    progress: number | null;
    phase: string | null;
    quote_count: number;
    pending_quotes: number;
    next_action: string | null;
  }>;
  crewDeployment: Array<{
    id: string;
    phase_name: string;
    project_name: string;
    project_id: string;
    project_address: string;
    start_date: string;
    end_date: string;
    status: string;
    assigned_to: string | null;
  }>;
  stats: {
    activeJobs: number;
    todos: number;
    quotesOut: number;
  };
}

export function CommandCenterShell({
  actionInbox,
  projects,
  crewDeployment,
  stats,
}: CommandCenterShellProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatContext, setChatContext] = useState<ChatContext>({});

  const openChat = useCallback((ctx: ChatContext = {}) => {
    setChatContext(ctx);
    setChatOpen(true);
  }, []);

  return (
    <>
      {/* Morning View: 3 collapsible sections */}
      <div className="flex flex-col gap-4 min-w-0 overflow-hidden">
        {/* Section 1: Action Inbox */}
        <ActionInbox
          todos={actionInbox.todos}
          quotes={actionInbox.quotes}
          emails={actionInbox.emails}
          onOpenChat={openChat}
        />

        {/* Section 2: Project Status Board */}
        <ProjectStatusBoard
          projects={projects}
          onOpenChat={(ctx) => openChat(ctx)}
        />

        {/* Section 3: Crew Deployment */}
        <CrewDeployment phases={crewDeployment} />
      </div>

      {/* AI Chat Panel (slide-out) */}
      <AIChatPanel
        open={chatOpen}
        onOpenChange={setChatOpen}
        projectId={chatContext.projectId}
        projectName={chatContext.projectName}
        initialMessage={chatContext.message}
      />

      {/* Floating chat trigger button */}
      {!chatOpen && <AIChatTrigger onClick={() => openChat()} />}
    </>
  );
}
