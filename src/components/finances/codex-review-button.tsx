"use client";

import { useId, useState } from "react";
import { Copy, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BottomSheet, BottomSheetBody, BottomSheetContent, BottomSheetDescription,
  BottomSheetFooter, BottomSheetHeader, BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import {
  buildCodexReviewUrl, buildReviewPrompt, DEFAULT_CODEX_WORKSPACE,
  isAbsoluteWorkspace, type ReviewContext,
} from "@/lib/codex/review";

const WORKSPACE_KEY = "penney.codex.workspace";

export function CodexReviewButton({ context }: { context: ReviewContext }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [workspace, setWorkspace] = useState(DEFAULT_CODEX_WORKSPACE);
  const [status, setStatus] = useState("");
  const label = context.kind === "job" ? "Review job financials"
    : context.path.includes("range=week&") ? "Review this week" : "Review this period";
  const href = buildCodexReviewUrl(prompt, workspace);

  function prepareReview() {
    setPrompt(buildReviewPrompt(context, window.location.origin));
    setStatus("");
    try {
      setWorkspace(localStorage.getItem(WORKSPACE_KEY) || DEFAULT_CODEX_WORKSPACE);
    } catch { /* Storage is optional, including in private browsing. */ }
    setOpen(true);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("Prompt copied. Paste it into a new Codex task in Penney Construction.");
    } catch {
      setStatus("Copy was blocked. Select and copy the prompt above.");
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={prepareReview}>
        <Sparkles aria-hidden="true" />{label}
      </Button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle>{label}</BottomSheetTitle>
            <BottomSheetDescription>
              Review the prompt, then open it in Codex. Press Send there to start.
            </BottomSheetDescription>
          </BottomSheetHeader>
          <BottomSheetBody className="space-y-4">
            <div className="space-y-2">
              <label htmlFor={`${id}-prompt`} className="text-sm font-medium">Review prompt</label>
              <textarea id={`${id}-prompt`} value={prompt} onChange={event => { setPrompt(event.target.value); setStatus(""); }}
                rows={15} className="w-full rounded-md border bg-background p-3 text-sm leading-relaxed focus-visible:outline-ring" />
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-medium">Codex folder on this computer</summary>
              <div className="mt-3 space-y-2">
                <label htmlFor={`${id}-workspace`} className="text-xs text-muted-foreground">Penney Construction folder</label>
                <input id={`${id}-workspace`} value={workspace} onChange={event => setWorkspace(event.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm" spellCheck={false} />
                <p className="text-xs text-muted-foreground">Change this if Penney Construction is saved in a different folder on your computer.</p>
              </div>
            </details>
            {!isAbsoluteWorkspace(workspace) && <p role="alert" className="text-sm text-destructive">Enter the full folder path under “Codex folder on this computer”.</p>}
            <p className="text-xs text-muted-foreground">Requires the Codex desktop app on this computer. On another device, copy the prompt and open Codex on your computer.</p>
            <p role="status" className="text-sm text-muted-foreground">{status}</p>
          </BottomSheetBody>
          <BottomSheetFooter>
            {href ? (
              <Button asChild>
                <a href={href} onClick={() => {
                  try { localStorage.setItem(WORKSPACE_KEY, workspace.trim()); } catch { /* Optional. */ }
                  setStatus("If Codex did not open, use Copy prompt below.");
                }}><ExternalLink aria-hidden="true" />Open in Codex</a>
              </Button>
            ) : <Button disabled>Open in Codex</Button>}
            <Button type="button" variant="outline" onClick={copyPrompt} disabled={!prompt.trim()}><Copy aria-hidden="true" />Copy prompt</Button>
          </BottomSheetFooter>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
