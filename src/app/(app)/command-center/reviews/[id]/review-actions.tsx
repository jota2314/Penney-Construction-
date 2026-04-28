"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle, Loader2, Send } from "lucide-react";
import { recordApprovalDecision, approveAndTestEmailProposal } from "@/lib/actions/estimate-approval";

export function ReviewActions({
  estimateId,
  isPending,
  isApproved,
  isChanges,
  existingNotes,
}: {
  estimateId: string;
  isPending: boolean;
  isApproved: boolean;
  isChanges: boolean;
  existingNotes: string;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(existingNotes);
  const [submitting, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: "approved" | "changes_requested") => {
    setError(null);
    if (decision === "changes_requested" && !notes.trim()) {
      setError("Add a note telling Jorge what to change.");
      return;
    }
    startTransition(async () => {
      const res = await recordApprovalDecision(estimateId, decision, notes.trim() || undefined);
      if (!res.success) setError(res.error || "Something went wrong");
      else router.refresh();
    });
  };

  const testApproveAndEmail = () => {
    setError(null);
    startTransition(async () => {
      const res = await approveAndTestEmailProposal(estimateId);
      if (!res.success) setError(res.error || "Test send failed");
      else router.refresh();
    });
  };

  // Already decided — allow re-decision but show current state
  const decidedBanner = isApproved
    ? "This proposal is approved. You can still change your mind or add notes."
    : isChanges
      ? "You requested changes. Jorge will revise and resubmit."
      : null;

  return (
    <section className="sticky bottom-4 bg-card border border-border rounded-xl p-5 shadow-md">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Your decision</div>
          <div className="text-[16px] font-semibold">
            {isPending ? "Review + decide" : isApproved ? "Approved" : isChanges ? "Changes requested" : "Not yet submitted"}
          </div>
        </div>
        {decidedBanner && (
          <div className="text-[12px] text-muted-foreground max-w-sm">{decidedBanner}</div>
        )}
      </div>

      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Notes for Jorge — what you love, what to tighten, pricing concerns, scope questions..."
        rows={4}
        className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-[13.5px] leading-relaxed resize-y outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20"
      />

      {error && (
        <div className="mt-2 text-[12px] text-red-600 dark:text-red-400">{error}</div>
      )}

      <div className="flex gap-2 mt-3 flex-wrap">
        <button
          onClick={() => decide("approved")}
          disabled={submitting}
          className="flex-1 min-w-[180px] inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg px-4 py-3 transition-colors disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Approve
        </button>
        <button
          onClick={() => decide("changes_requested")}
          disabled={submitting}
          className="flex-1 min-w-[180px] inline-flex items-center justify-center gap-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-700 dark:text-amber-300 font-semibold rounded-lg px-4 py-3 transition-colors disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
          Request changes
        </button>
      </div>

      {/* TEMPORARY — test button for end-to-end proposal-email QA. Approves
          the estimate and sends the proposal PDF to Jorge's inbox instead
          of the real client. Remove this block when testing is done. */}
      <div className="mt-3 pt-3 border-t border-dashed border-border/60">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Dev — test send
        </div>
        <button
          onClick={testApproveAndEmail}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 bg-fuchsia-500/15 hover:bg-fuchsia-500/25 border border-fuchsia-500/40 text-fuchsia-700 dark:text-fuchsia-300 font-semibold rounded-lg px-4 py-3 transition-colors disabled:opacity-50 text-[13.5px]"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          TEST — Approve + email proposal to me
        </button>
      </div>
    </section>
  );
}
