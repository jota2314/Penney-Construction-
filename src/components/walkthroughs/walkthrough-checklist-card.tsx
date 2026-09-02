"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { checklistFor, type ChecklistAnswer, type ChecklistAnswers } from "@/lib/constants/walkthrough-checklist";
import { saveWalkthroughChecklist, applyChecklistAllowances } from "@/lib/actions/walkthrough-checklist";
import { ClipboardCheck, Loader2, PlusCircle } from "lucide-react";

interface Props {
  walkthroughId: string;
  projectType: string | null;
  initialAnswers: ChecklistAnswers;
  hasEstimate: boolean;
}

const OPTIONS: Array<{ value: ChecklistAnswer; label: string; cls: string }> = [
  { value: "yes", label: "Yes", cls: "data-[on=true]:bg-green-500/20 data-[on=true]:text-green-300 data-[on=true]:border-green-500/40" },
  { value: "no", label: "No", cls: "data-[on=true]:bg-red-500/20 data-[on=true]:text-red-300 data-[on=true]:border-red-500/40" },
  { value: "unknown", label: "?", cls: "data-[on=true]:bg-amber-500/20 data-[on=true]:text-amber-300 data-[on=true]:border-amber-500/40" },
];

export function WalkthroughChecklistCard({ walkthroughId, projectType, initialAnswers, hasEstimate }: Props) {
  const questions = useMemo(() => checklistFor(projectType), [projectType]);
  const [answers, setAnswers] = useState<ChecklistAnswers>(initialAnswers);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (questions.length === 0) return null;

  const answered = questions.filter((q) => answers[q.key]?.answer).length;
  const openTriggers = questions.filter((q) => q.kind === "trigger" && answers[q.key]?.answer !== "yes").length;

  function set(key: string, answer: ChecklistAnswer) {
    setAnswers((a) => ({ ...a, [key]: { ...(a[key] ?? {}), answer } }));
    setDirty(true);
    setMsg(null);
  }
  function setNote(key: string, note: string) {
    setAnswers((a) => ({ ...a, [key]: { answer: a[key]?.answer ?? "unknown", note } }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    const res = await saveWalkthroughChecklist(walkthroughId, answers);
    setSaving(false);
    if (res.error) setMsg(res.error);
    else {
      setDirty(false);
      setMsg("Saved");
    }
  }

  async function apply() {
    if (dirty) await save();
    setApplying(true);
    const res = await applyChecklistAllowances(walkthroughId);
    setApplying(false);
    if (res.error) setMsg(res.error);
    else setMsg(res.added === 0 ? "Every trigger already has an allowance line." : `Added ${res.added} allowance line${res.added === 1 ? "" : "s"} to the estimate.`);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-orange-400" />
            Checklist
            <span className="text-xs font-normal text-muted-foreground">{answered}/{questions.length}</span>
          </CardTitle>
          <div className="flex items-center gap-1">
            {dirty && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </Button>
            )}
            {hasEstimate && (
              <Button size="sm" className="h-7 text-xs bg-orange-500 hover:bg-orange-600 text-white" onClick={apply} disabled={applying}>
                {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlusCircle className="h-3 w-3 mr-1" />}
                Add allowance lines{openTriggers > 0 ? ` (${openTriggers})` : ""}
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Yes means the safe condition holds. No or ? on a trigger becomes a priced allowance on the proposal, not a guess.
        </p>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {questions.map((q) => {
          const a = answers[q.key];
          const showNote = q.kind === "trigger" && a?.answer && a.answer !== "yes";
          return (
            <div key={q.key} className="rounded-md border border-border/60 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-2">{q.trade}</span>
                  {q.label}
                  {q.kind === "trigger" && <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400/80">trigger</span>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      data-on={a?.answer === o.value}
                      onClick={() => set(q.key, o.value)}
                      className={cn(
                        "h-7 min-w-8 px-2 rounded border border-border text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500",
                        o.cls
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {showNote && (
                <input
                  value={a?.note ?? ""}
                  onChange={(e) => setNote(q.key, e.target.value)}
                  placeholder="What did you see? (goes on the allowance line)"
                  className="mt-2 w-full bg-transparent border-b border-border/60 text-xs py-1 focus:outline-none focus:border-orange-500"
                />
              )}
            </div>
          );
        })}
        {msg && <p className="text-xs text-muted-foreground pt-1">{msg}</p>}
      </CardContent>
    </Card>
  );
}
