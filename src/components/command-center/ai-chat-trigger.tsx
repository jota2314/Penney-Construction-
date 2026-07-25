"use client";

import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Floating button to open the AI Chat panel.
 *
 * Deliberately lives in its own module: it used to be exported from
 * ai-chat-panel.tsx, so every page that only wanted this ~15-line button
 * pulled the entire 850-line chat panel (plus ChatInput, ChatMessage, Sheet,
 * EmailAutocomplete and a Supabase client) into its bundle. The panel itself
 * is now lazy-loaded on first open.
 */
export function AIChatTrigger({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "fixed bottom-6 right-6 z-40 hidden md:flex h-14 w-14 items-center justify-center rounded-full bg-amber-600 text-white shadow-lg hover:bg-amber-700 transition-all hover:scale-105 active:scale-95",
        className
      )}
      title="Open AI Assistant"
    >
      <Bot className="h-6 w-6" />
    </button>
  );
}
