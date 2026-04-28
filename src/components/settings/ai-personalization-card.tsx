"use client";

import { useState, useTransition } from "react";
import { Sparkles, Trash2, Save, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { saveUserAiInstructions, deleteUserMemory, type StoredMemory } from "@/lib/actions/ai-personalization";

const CATEGORY_LABELS: Record<string, string> = {
  user_preference: "Your preferences",
  company_rule: "Company rules",
  workflow_pattern: "Workflow patterns",
  entity_note: "People & vendors",
  correction: "Corrections it learned",
};

const CATEGORY_HINTS: Record<string, string> = {
  user_preference: "Things you like — tone, formats, defaults.",
  company_rule: "Hard rules across the business.",
  workflow_pattern: "How you tend to handle things.",
  entity_note: "Facts about clients, subs, employees.",
  correction: "Mistakes to avoid in the future.",
};

export function AiPersonalizationCard({
  initialInstructions,
  initialMemories,
  firstName,
}: {
  initialInstructions: string;
  initialMemories: StoredMemory[];
  firstName: string | null;
}) {
  const [instructions, setInstructions] = useState(initialInstructions);
  const [savedSnapshot, setSavedSnapshot] = useState(initialInstructions);
  const [memories, setMemories] = useState(initialMemories);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = instructions !== savedSnapshot;
  const characterCount = instructions.length;

  const onSave = () => {
    setStatus("saving");
    setErrorMsg(null);
    startTransition(async () => {
      const result = await saveUserAiInstructions(instructions);
      if (result.ok) {
        setSavedSnapshot(instructions);
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2200);
      } else {
        setStatus("error");
        setErrorMsg(result.error);
      }
    });
  };

  const onDelete = (id: string) => {
    const optimistic = memories.filter((m) => m.id !== id);
    setMemories(optimistic);
    startTransition(async () => {
      const result = await deleteUserMemory(id);
      if (!result.ok) {
        // Restore on failure
        setMemories(initialMemories);
        setErrorMsg(result.error);
      }
    });
  };

  const grouped = memories.reduce<Record<string, StoredMemory[]>>((acc, m) => {
    (acc[m.category] ??= []).push(m);
    return acc;
  }, {});
  const orderedCategories = Object.keys(CATEGORY_LABELS).filter((c) => grouped[c]?.length);
  for (const c of Object.keys(grouped)) {
    if (!orderedCategories.includes(c)) orderedCategories.push(c);
  }

  const promptPlaceholder = [
    `Tell the AI things it should always know about you.`,
    `Examples:`,
    `- I'm an estimator. Default to numbers, materials, scope language.`,
    `- I prefer short, direct replies. Skip the preamble.`,
    `- Always check the cost book before quoting a trade.`,
    `- For client emails, sign as "${firstName ?? "—"}".`,
    `- I don't use Excel. Send proposals as PDF only.`,
  ].join("\n");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          AI Instructions
        </CardTitle>
        <CardDescription>
          Teach the AI how you work. These instructions are loaded into every AI chat you start
          (Brain, Project, Email, Schedule, Takeoff). Only you see and use them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Textarea
            value={instructions}
            onChange={(e) => {
              setInstructions(e.target.value);
              if (status === "saved") setStatus("idle");
            }}
            placeholder={promptPlaceholder}
            rows={9}
            className="resize-y font-[inherit] text-[14px] leading-relaxed"
            maxLength={10_000}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {characterCount.toLocaleString()} / 10,000 chars
              {dirty && <span className="ml-2 text-amber-500 font-medium">· unsaved</span>}
            </span>
            <div className="flex items-center gap-2">
              {status === "saved" && (
                <span className="text-emerald-500 font-medium">Saved.</span>
              )}
              {status === "error" && errorMsg && (
                <span className="text-rose-500 font-medium truncate max-w-[260px]">{errorMsg}</span>
              )}
              <Button
                onClick={onSave}
                disabled={!dirty || pending}
                size="sm"
                className="gap-1.5"
              >
                {status === "saving" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <h4 className="text-sm font-medium">What the AI has learned</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Saved from your past chats — usually when you said &quot;remember that…&quot;.
                Delete anything that&apos;s wrong or out of date.
              </p>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {memories.length} {memories.length === 1 ? "item" : "items"}
            </span>
          </div>

          {memories.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing yet. Try saying things like &quot;Remember that I always default markup at 30%&quot;
              or &quot;Remember that Chuck Pappas only takes calls before 8am&quot; in any AI chat —
              they&apos;ll show up here.
            </div>
          ) : (
            <div className="space-y-4">
              {orderedCategories.map((cat) => (
                <div key={cat}>
                  <div className="flex items-baseline justify-between mb-2">
                    <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {CATEGORY_LABELS[cat] ?? cat}
                    </h5>
                    <span className="text-[11px] text-muted-foreground/70">
                      {CATEGORY_HINTS[cat] ?? ""}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {grouped[cat].map((m) => (
                      <li
                        key={m.id}
                        className="group flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
                      >
                        <p className="flex-1 text-sm leading-snug whitespace-pre-wrap break-words">
                          {m.value}
                        </p>
                        <button
                          onClick={() => onDelete(m.id)}
                          aria-label="Delete memory"
                          className="opacity-40 hover:opacity-100 transition flex-shrink-0 mt-0.5 text-muted-foreground hover:text-rose-400"
                          disabled={pending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
