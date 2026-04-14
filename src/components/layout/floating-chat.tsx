"use client";

import { useState } from "react";
import { AIChatPanel, AIChatTrigger } from "@/components/command-center/ai-chat-panel";

/**
 * Floating AI chat bubble — visible on every page.
 * Shows the amber circle button in bottom-right; opens the slide-out panel.
 */
export function FloatingChat() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <>
      <AIChatPanel open={chatOpen} onOpenChange={setChatOpen} />
      {!chatOpen && <AIChatTrigger onClick={() => setChatOpen(true)} />}
    </>
  );
}
