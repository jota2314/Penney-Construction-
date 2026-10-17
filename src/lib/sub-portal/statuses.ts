/**
 * The status words the sub portal decides things by, in one place, so the
 * Today list, the Money tab, the QR signs, the rollout page and the digest
 * all agree on what "a live job" and "a bill he's owed on" mean.
 */

/**
 * Job statuses that belong on a sub's live list: being built, signed and
 * coming, or paused. `audit` (closing out) was dropped in v3 — it padded
 * Marcio's list to 30 jobs.
 */
export const SUB_LIVE_STATUSES = ["in_progress", "contracted", "on_hold"] as const;
export type SubLiveStatus = (typeof SUB_LIVE_STATUSES)[number];

export function isSubLiveStatus(status: string | null | undefined): status is SubLiveStatus {
  return !!status && (SUB_LIVE_STATUSES as readonly string[]).includes(status);
}

/** Building first, then signed-and-coming, then on hold; anything else last. */
export function subLiveRank(status: string | null | undefined): number {
  const i = status ? (SUB_LIVE_STATUSES as readonly string[]).indexOf(status) : -1;
  return i === -1 ? SUB_LIVE_STATUSES.length : i;
}

/**
 * The windows of the active-job rule (plan §2.3). A live-status job is on his
 * list when ANY of these hold. active-jobs.ts applies them; the numbers live
 * here so the digest and rollout counts use the same ones.
 */
export const SUB_ACTIVE_JOB_WINDOWS = {
  /** An assigned phase that started up to this many days ago… */
  phasePastDays: 30,
  /** …or starts within this many days. */
  phaseFutureDays: 60,
  /** A visit or a post of his in the last N days. */
  activityDays: 30,
  /** A bill of his in the last N days. */
  billDays: 60,
} as const;

/** Today list sections: an assigned phase within this many days is "This week". */
export const SUB_THIS_WEEK_DAYS = 7;

/** Quote/bid statuses that mean "you got the job". */
export const SUB_AWARDED_QUOTE_STATUSES = ["accepted", "approved"] as const;

export function isAwardedQuoteStatus(status: string | null | undefined): boolean {
  return !!status && (SUB_AWARDED_QUOTE_STATUSES as readonly string[]).includes(status);
}

/** How a quote or bid reads to the sub (SubQuote.stage). */
export type SubQuoteStage = "awarded" | "under_review" | "not_selected" | "price_needed";

/** The pill words, sentence case. */
export const SUB_QUOTE_STAGE_LABEL: Record<SubQuoteStage, string> = {
  awarded: "Awarded",
  under_review: "Under review",
  not_selected: "Not selected",
  price_needed: "Price needed",
};

/**
 * quote_requests.status / subcontractor_bids.status → the stage he sees.
 * Same mapping as the v2 portal's quoteStatusLabel; anything unknown reads
 * as "Under review" rather than leaking an internal word.
 */
export function subQuoteStage(status: string | null | undefined): SubQuoteStage {
  switch (status) {
    case "accepted":
    case "approved":
      return "awarded";
    case "declined":
    case "rejected":
      return "not_selected";
    case "just_sent":
    case "awaiting_reply":
    case "invited":
      return "price_needed";
    default:
      return "under_review";
  }
}

/** project_subcontractors.status (migration 20261017120000). */
export const PROJECT_SUB_STATUSES = ["active", "visit_only", "done", "removed"] as const;
export type ProjectSubStatus = (typeof PROJECT_SUB_STATUSES)[number];

/** A job link that still counts toward the active-job rule. */
export function isActiveProjectSub(status: string | null | undefined): boolean {
  // Rows from before the migration have no status in old selects; treat as active.
  return !status || status === "active";
}

/** The hint guard_locked_sub_contract raises when a write hits a signed work order's lock. */
export const SUB_CONTRACT_LOCKED_HINT = "sub_contract_locked";

/**
 * The refusal to show when a project_subcontractors write hit the lock
 * ("Locked by WO-046-01; use a sub change order"), or null for any other
 * error. Pass the Supabase error as is. Meant for awardQuote, awardBid and
 * upsertContractAmount, so none of them reports a refused write as done.
 */
export function subContractLockedMessage(
  error: { hint?: string | null; message?: string | null } | null | undefined,
): string | null {
  if (!error) return null;
  const message = error.message?.trim() ?? "";
  if (error.hint !== SUB_CONTRACT_LOCKED_HINT && !message.startsWith("Locked by ")) return null;
  return message || "Locked by a signed work order; use a sub change order";
}

/**
 * Bills he is OWED on: anything Penney has reviewed. A bill still marked
 * needs_review is "Sent, waiting for Penney", never owed — counting it is
 * the overcount v3 fixed.
 */
export function countsTowardOwed(reviewStatus: string | null | undefined): boolean {
  return reviewStatus !== "needs_review";
}

/** sub_agreements.status. */
export const SUB_AGREEMENT_STATUSES = ["draft", "sent", "viewed", "signed", "void", "superseded"] as const;
export type SubAgreementStatus = (typeof SUB_AGREEMENT_STATUSES)[number];

/** Agreements that sit in his "Needed from you" list: sent and not yet signed. */
export const SUB_AGREEMENT_AWAITING_SIGN = ["sent", "viewed"] as const;

export function isAwaitingSubSignature(status: string | null | undefined): boolean {
  return !!status && (SUB_AGREEMENT_AWAITING_SIGN as readonly string[]).includes(status);
}

/** sub_agreement_templates.status. */
export const SUB_TEMPLATE_STATUSES = ["draft", "approved", "retired"] as const;
export type SubTemplateStatus = (typeof SUB_TEMPLATE_STATUSES)[number];

/**
 * The blank marker in drafted agreement text. A template can't be approved
 * (DB check `approved_needs_review`) and nothing can be sent while one is left.
 */
export const FILL_IN_TOKEN = "[FILL IN";

export function hasFillInBlank(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && t.includes(FILL_IN_TOKEN));
}

/** sub_bill_submissions.status. "Filed" is never stored; it's derived from invoices. */
export const SUB_BILL_SUBMISSION_STATUSES = ["sent", "returned"] as const;
export type SubBillSubmissionStatus = (typeof SUB_BILL_SUBMISSION_STATUSES)[number];

/** sub_site_visits.first_source. */
export const SUB_VISIT_SOURCES = ["qr", "post", "clock", "office"] as const;
export type SubVisitSource = (typeof SUB_VISIT_SOURCES)[number];
