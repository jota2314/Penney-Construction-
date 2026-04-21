"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, AlertCircle, Clock, Send, Loader2, ExternalLink } from "lucide-react";
import { submitEstimateForReview } from "@/lib/actions/estimate-approval";

type Status = "draft" | "pending_review" | "approved" | "changes_requested";

export function ApprovalBanner({
  estimateId,
  approvalStatus,
  approvalNotes,
  submittedAt,
  reviewedAt,
}: {
  estimateId: string;
  approvalStatus: Status;
  approvalNotes: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [submitting, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await submitEstimateForReview(estimateId, note.trim() || undefined);
      if (!res.success) setError(res.error || "Failed to submit");
      else {
        setShowNote(false);
        setNote("");
        router.refresh();
      }
    });
  };

  if (approvalStatus === "approved") {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center gap-3 mb-4">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-200">
            Ryan approved this proposal{reviewedAt ? ` · ${new Date(reviewedAt).toLocaleDateString()}` : ""}
          </div>
          {approvalNotes && (
            <div className="text-[12px] text-emerald-700/90 dark:text-emerald-300/90 mt-0.5 whitespace-pre-wrap">{approvalNotes}</div>
          )}
          <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 mt-1">
            Ready to send to the client.
          </div>
        </div>
        <Link
          href={`/command-center/reviews/${estimateId}`}
          className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300 hover:underline inline-flex items-center gap-1 shrink-0"
        >
          View review <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  if (approvalStatus === "changes_requested") {
    return (
      <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-3 mb-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
              Ryan requested changes
            </div>
            {approvalNotes && (
              <div className="text-[12.5px] text-amber-900/90 dark:text-amber-200/90 mt-1 p-2.5 rounded-md bg-amber-500/10 whitespace-pre-wrap">
                {approvalNotes}
              </div>
            )}
            <button
              onClick={submit}
              disabled={submitting}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[12.5px] rounded-md transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Resubmit for review
            </button>
          </div>
        </div>
        {error && <div className="text-[12px] text-red-600 dark:text-red-400 mt-2 ml-8">{error}</div>}
      </div>
    );
  }

  if (approvalStatus === "pending_review") {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center gap-3 mb-4">
        <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-amber-800 dark:text-amber-200">
            Waiting for Ryan&apos;s review{submittedAt ? ` · sent ${new Date(submittedAt).toLocaleDateString()}` : ""}
          </div>
          <div className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-0.5">
            You&apos;ll get an email when he approves or asks for changes.
          </div>
        </div>
        <Link
          href={`/command-center/reviews/${estimateId}`}
          className="text-[12px] font-semibold text-amber-700 dark:text-amber-300 hover:underline inline-flex items-center gap-1 shrink-0"
        >
          View <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  // Draft — the submit action
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="h-8 w-8 rounded-lg bg-muted grid place-items-center shrink-0">
            <Send className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">Ready for Ryan?</div>
            <div className="text-[11.5px] text-muted-foreground">
              Send to Ryan for review before the client sees it.
            </div>
          </div>
        </div>
        {!showNote && (
          <button
            onClick={() => setShowNote(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[12.5px] rounded-md transition-colors shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
            Submit for review
          </button>
        )}
      </div>
      {showNote && (
        <div className="mt-3">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="Optional note for Ryan — anything you want him to focus on?"
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-[13px] outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={submit}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[12.5px] rounded-md transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send to Ryan
            </button>
            <button
              onClick={() => { setShowNote(false); setNote(""); setError(null); }}
              className="px-3 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          {error && <div className="text-[12px] text-red-600 dark:text-red-400 mt-2">{error}</div>}
        </div>
      )}
    </div>
  );
}
