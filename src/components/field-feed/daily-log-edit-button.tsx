"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { editDailyLog } from "@/lib/actions/daily-logs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { v } from "./tokens";

export function DailyLogEditButton({ logId, text, onSaved }: {
  logId: string;
  text: string | null;
  onSaved: (text: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await editDailyLog({ logId, text: draft, originalText });
        if (!result.ok) { setError(result.error); return; }
        onSaved(result.text);
        setOpen(false);
        router.refresh();
      } catch {
        setError("Could not save the daily log. Your edits are still here; try again.");
      }
    });
  }

  return <>
    <button type="button" aria-label="Edit daily log"
      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold"
      style={{ color: v("accent") }}
      onClick={() => { setDraft(text ?? ""); setOriginalText(text); setError(null); setOpen(true); }}>
      <Pencil className="h-3.5 w-3.5" /> Edit
    </button>
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit daily log</DialogTitle>
          <DialogDescription>Update the written details for this daily log.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); save(); }} className="space-y-4">
          <label className="block space-y-2 text-sm font-medium">
            <span>Daily log details</span>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)}
              rows={8} maxLength={20000} required disabled={pending} autoFocus
              className="w-full rounded-md border bg-background p-3 text-base font-normal" />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !draft.trim()}>{pending ? "Saving…" : "Save changes"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
