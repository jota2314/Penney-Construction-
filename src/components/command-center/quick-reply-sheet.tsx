"use client";

import { useEffect, useRef, useState } from "react";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetDescription,
  BottomSheetBody,
  BottomSheetFooter,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Send,
  Pencil,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

export interface QuickReplyDraft {
  to_email: string;
  to_name: string;
  subject: string;
  body: string;
}

const REGENERATE_PRESETS: { id: string; label: string; hint: string }[] = [
  { id: "shorter", label: "Shorter", hint: "Make it shorter — under 40 words." },
  {
    id: "more_formal",
    label: "More formal",
    hint: "More formal tone, but still concise.",
  },
  {
    id: "ask_for_date",
    label: "Ask for date",
    hint: "Ask the sender to propose a specific date/time.",
  },
  {
    id: "decline",
    label: "Decline politely",
    hint: "Politely decline what they're asking for, brief reason.",
  },
];

interface QuickReplySheetProps {
  open: boolean;
  onClose: () => void;
  /** Initial draft loaded from /api/email-chat. null while loading. */
  draft: QuickReplyDraft | null;
  /** True while initial fetch or regenerate is in flight. */
  loading: boolean;
  /** Tap Regenerate → caller fetches a new draft using this hint. */
  onRegenerate: (hint: string) => void;
  /**
   * Send. Caller is responsible for the 3-second undo window AND for actually
   * pushing to Gmail — this sheet just hands off the final body.
   */
  onSend: (finalDraft: QuickReplyDraft) => void;
}

export function QuickReplySheet(props: QuickReplySheetProps) {
  // Mount the inner sheet only while open so internal useState resets
  // naturally between sessions — avoids synchronizing prop→state in effects.
  return (
    <BottomSheet open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      {props.open && <QuickReplySheetInner {...props} />}
    </BottomSheet>
  );
}

function QuickReplySheetInner({
  draft,
  loading,
  onRegenerate,
  onSend,
}: QuickReplySheetProps) {
  const [editing, setEditing] = useState(false);
  // Track the draft.body we've reconciled with so a fresh draft (e.g. after
  // Regenerate) overwrites local edits — read pattern from React docs.
  const [reconciledBody, setReconciledBody] = useState(draft?.body ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  if (draft && draft.body !== reconciledBody) {
    setReconciledBody(draft.body);
    setBody(draft.body);
  }
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [customHint, setCustomHint] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 200)}px`;
  }, [body, editing]);

  function handleSend() {
    if (!draft) return;
    onSend({ ...draft, body });
  }

  function handleRegenerateChip(hint: string) {
    setShowRegenerate(false);
    setShowCustomInput(false);
    setCustomHint("");
    onRegenerate(hint);
  }

  function handleCustomSubmit() {
    const trimmed = customHint.trim();
    if (!trimmed) return;
    handleRegenerateChip(trimmed);
  }

  return (
    <>
      <BottomSheetContent>
        <BottomSheetHeader>
          <BottomSheetTitle>
            Reply to {draft?.to_name || draft?.to_email || "…"}
          </BottomSheetTitle>
          {draft?.subject && (
            <BottomSheetDescription>{draft.subject}</BottomSheetDescription>
          )}
        </BottomSheetHeader>

        <BottomSheetBody>
          {loading && !draft && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
              <p className="text-xs text-muted-foreground">
                Drafting reply in your voice…
              </p>
            </div>
          )}

          {draft && (
            <>
              {editing ? (
                <textarea
                  ref={textareaRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full text-sm leading-relaxed rounded-lg border bg-background p-3 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                  placeholder="Type your reply…"
                  disabled={loading}
                />
              ) : (
                <div
                  className={`text-sm leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/40 p-3 border ${loading ? "opacity-50" : ""}`}
                >
                  {body || <span className="text-muted-foreground italic">No body</span>}
                </div>
              )}

              {loading && draft && (
                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
                  Regenerating…
                </div>
              )}

              {/* Regenerate quick-pick */}
              {showRegenerate && !loading && (
                <div className="mt-4 rounded-lg border bg-background p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-amber-500" />
                      How should I redo it?
                    </p>
                    <button
                      onClick={() => {
                        setShowRegenerate(false);
                        setShowCustomInput(false);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {REGENERATE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleRegenerateChip(p.hint)}
                        className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-amber-500/15 hover:text-amber-500 transition-colors"
                      >
                        {p.label}
                      </button>
                    ))}
                    <button
                      onClick={() => setShowCustomInput((v) => !v)}
                      className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                        showCustomInput
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-muted hover:bg-amber-500/15 hover:text-amber-500"
                      }`}
                    >
                      Custom…
                    </button>
                  </div>

                  {showCustomInput && (
                    <div className="flex gap-1.5 pt-1">
                      <input
                        autoFocus
                        value={customHint}
                        onChange={(e) => setCustomHint(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleCustomSubmit();
                          }
                        }}
                        placeholder="e.g. include that we'll start Monday"
                        className="flex-1 text-xs px-3 py-2 rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                      />
                      <Button
                        size="sm"
                        onClick={handleCustomSubmit}
                        disabled={!customHint.trim()}
                        className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        Go
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </BottomSheetBody>

        <BottomSheetFooter>
          {draft && !editing && !showRegenerate && (
            <div className="flex gap-2">
              <Button
                onClick={handleSend}
                disabled={loading || !body.trim()}
                className="flex-1 h-11 bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
              >
                <Send className="h-4 w-4 mr-2" />
                Send
              </Button>
              <Button
                variant="outline"
                onClick={() => setEditing(true)}
                disabled={loading}
                className="h-11 rounded-xl"
              >
                <Pencil className="h-4 w-4 mr-1.5" />
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowRegenerate(true)}
                disabled={loading}
                className="h-11 rounded-xl"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          )}

          {draft && editing && (
            <div className="flex gap-2">
              <Button
                onClick={handleSend}
                disabled={loading || !body.trim()}
                className="flex-1 h-11 bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
              >
                <Send className="h-4 w-4 mr-2" />
                Send
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setBody(draft.body);
                }}
                disabled={loading}
                className="h-11 rounded-xl"
              >
                Cancel
              </Button>
            </div>
          )}

          {draft && showRegenerate && (
            <Button
              variant="outline"
              onClick={() => setShowRegenerate(false)}
              className="h-11 rounded-xl"
            >
              Back
            </Button>
          )}
        </BottomSheetFooter>
      </BottomSheetContent>
    </>
  );
}
