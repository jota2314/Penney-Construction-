"use client";

import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  X,
  Loader2,
  ChevronDown,
  Mail,
} from "lucide-react";
import type { DraftState, StoredEmail } from "@/components/command-center/email-detail-types";

interface EmailDraftEditorProps {
  open: boolean;
  draft: DraftState;
  originalEmail: StoredEmail;
  onUpdateField: (field: keyof DraftState, value: string) => void;
  onSend: () => void;
  onDiscard: () => void;
  sending: boolean;
}

export function EmailDraftEditor({
  open,
  draft,
  originalEmail,
  onUpdateField,
  onSend,
  onDiscard,
  sending,
}: EmailDraftEditorProps) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the body when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => bodyRef.current?.focus(), 200);
    }
  }, [open]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 200)}px`;
  }, [draft.body]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60"
        onClick={onDiscard}
      />

      {/* Modal */}
      <div className="fixed inset-4 md:inset-x-[10%] md:inset-y-[5%] z-50 flex flex-col bg-background rounded-lg border shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">Compose Reply</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8 text-muted-foreground"
              onClick={onDiscard}
              disabled={sending}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Discard
            </Button>
            <Button
              size="sm"
              className="text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white"
              onClick={onSend}
              disabled={sending}
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1.5" />
              )}
              Send
            </Button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Email fields */}
          <div className="px-4 py-3 space-y-2.5 border-b">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-10 shrink-0 font-medium">To:</label>
              <Input
                value={draft.to}
                onChange={(e) => onUpdateField("to", e.target.value)}
                className="text-sm h-9"
                placeholder="recipient@email.com"
                disabled={sending}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-10 shrink-0 font-medium">CC:</label>
              <Input
                value={draft.cc}
                onChange={(e) => onUpdateField("cc", e.target.value)}
                className="text-sm h-9"
                placeholder="cc@email.com (optional)"
                disabled={sending}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-10 shrink-0 font-medium">Subj:</label>
              <Input
                value={draft.subject}
                onChange={(e) => onUpdateField("subject", e.target.value)}
                className="text-sm h-9"
                disabled={sending}
              />
            </div>
          </div>

          {/* Body editor */}
          <div className="px-4 py-3">
            <Textarea
              ref={bodyRef}
              value={draft.body}
              onChange={(e) => onUpdateField("body", e.target.value)}
              className="text-sm min-h-[250px] resize-none border-0 shadow-none focus-visible:ring-0 p-0"
              placeholder="Write your email..."
              disabled={sending}
            />
          </div>

          {/* Original email reference */}
          <details className="mx-4 mb-4 border rounded-lg">
            <summary className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground cursor-pointer hover:bg-muted/50">
              <ChevronDown className="h-3 w-3" />
              Original email from {originalEmail.from_name || originalEmail.from_email}
            </summary>
            <div className="px-3 pb-3 text-xs text-muted-foreground/70 whitespace-pre-wrap max-h-48 overflow-y-auto border-t pt-2">
              {originalEmail.body || originalEmail.snippet || "No content"}
            </div>
          </details>
        </div>

        {/* Bottom send bar (visible on all sizes) */}
        <div className="px-4 py-3 border-t shrink-0 flex justify-between items-center bg-muted/30">
          <p className="text-xs text-muted-foreground">
            Use the AI chat to refine this email
          </p>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={onSend}
            disabled={sending}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Email
          </Button>
        </div>
      </div>
    </>
  );
}
