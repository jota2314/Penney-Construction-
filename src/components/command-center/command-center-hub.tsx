"use client";

import { useState, useCallback } from "react";
import { NavigationTileGrid } from "./navigation-tile-grid";
import dynamic from "next/dynamic";
import { AIChatTrigger } from "./ai-chat-trigger";
import type { HubMetrics } from "@/lib/actions/command-center-hub";

const AIChatPanel = dynamic(() => import("./ai-chat-panel").then((m) => m.AIChatPanel), {
  ssr: false,
});

interface ChatContext {
  projectId?: string;
  projectName?: string;
  message?: string;
}

interface CommandCenterHubProps {
  metrics: HubMetrics;
}

export function CommandCenterHub({ metrics }: CommandCenterHubProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatContext, setChatContext] = useState<ChatContext>({});

  const openChat = useCallback((ctx: ChatContext = {}) => {
    setChatContext(ctx);
    setChatOpen(true);
  }, []);

  return (
    <>
      <NavigationTileGrid metrics={metrics} />

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
