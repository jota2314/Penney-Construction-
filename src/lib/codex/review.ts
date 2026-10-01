export type ReviewContext =
  | { kind: "weekly"; label: string; startDate: string; endDate: string; path: string }
  | { kind: "job"; projectId: string };

// Override per device in the review panel when using another computer.
export const DEFAULT_CODEX_WORKSPACE = "C:\\Users\\rajat\\Penney Construction";

export function buildReviewPrompt(context: ReviewContext, origin: string): string {
  if (context.kind === "job") {
    return `Complete one coordinated, evidence-backed project review covering three areas together: financials, daily logs and photos, and schedule/progress for Penney project ID ${context.projectId}.
Page: ${origin}/projects/${encodeURIComponent(context.projectId)}?tab=finances
Resolve and state the job name. Explain where the project stands now, which phase or phases are active, how far along it is, and what is off. Complete all three reviews and save their findings together; a dashboard summary or schedule-only audit is insufficient.

Start by reading AGENTS.md, FINANCIAL_REVIEW_WORKFLOW.md, relevant Penney memory, financial-reviews/index.json and this job's latest saved review. Look in the project's Files > Other for earlier audits if the local baseline is unavailable. Use connected Penney tools and reliable Penney records within my authorized access; do not rely on QuickBooks.

Fetch current records and compare them with the prior baseline, including new or edited older transactions and changed source documents. Inspect new/changed evidence and every unresolved issue. Carry forward unchanged verified evidence with its verification date; refresh totals and payment/inspection status each time. If no baseline exists, perform the full initial audit. Do not treat missing or truncated records as zero costs or cleared issues.

Reconcile the signed contract, budget lines, allowances, approved change orders and credits against actual costs and estimated remaining costs. Inspect underlying vendor bills and receipts for vendor, job, date, arithmetic, budget allocation, splits, duplicates, credits and payment evidence. Count each allocation once; add only the unbilled remainder of commitments, and separate unawarded quotes from commitments. Reconcile labor using the app's shared calculation, historical rates, breaks across same-day jobs and payroll overrides; match subcontractor bills to service periods without pricing the same labor twice. Distinguish modeled wages from payroll-confirmed and fully burdened costs.

Inspect permit documents and fee receipts for the correct job, issuance, expiration and available inspections. Distinguish payment, issuance and passed inspections; apply permit-allowance rules prospectively without rewriting existing signed contracts. Compare native client invoices and their actually sent versions with the signed billing schedule, advances, credits, receipts and available bank evidence. Separate drafts and future milestones from amounts currently due or overdue; do not infer unpaid balances from stale status alone.

Review the project's daily logs, field reports, crew entries, relevant attachments and progress photos. Actually open and visually inspect the photos; filenames, captions and attachment counts are not visual evidence. For an initial review, cover the available project history; on later reviews inspect all new/changed logs and photos plus evidence relevant to unresolved issues. Match each log's date, location, trade, crew, hours, reported work, blockers and phase to its photos and related records. Flag missing expected logs or photos, conflicting dates, repeated evidence, unsupported completion claims, incomplete descriptions, and mismatches between recorded labor and reported work. Distinguish a confirmed discrepancy from a question needing field verification. Cite the specific log and photo/file IDs or links and dates. Report inaccessible images and coverage gaps explicitly; do not infer concealed work, code compliance or passed inspections from appearance alone.

Audit the schedule against that field evidence, the agreed scope, dependencies, deliveries, inspections, change orders and punch-list records. Identify completed, active, blocked and not-started phases, including concurrent phases. Compare planned versus evidenced actual starts/finishes, flag stale schedule statuses, sequencing conflicts, delays and unsupported progress claims, and state what must happen next and who needs to act when ownership is recorded. Give an as-of date and the latest field-evidence date. Estimate completion by phase and overall only when supported, explaining the method, remaining work and uncertainty; do not equate money spent, elapsed time or the raw count of completed phases with physical completion. If a defensible percentage is unavailable, say so and describe the evidenced stage instead.

Cross-check all three areas: completed work that is not billed, invoices or labor unsupported by field records, materials paid for but not evidenced as delivered/installed, and schedule delays affecting remaining cost or the next billing milestone. Treat these as review flags until verified, not automatic proof of an error. Lead the report with current phase(s), evidenced progress, schedule position, financial position, key discrepancies and prioritized next steps, then separate findings into Financials, Daily logs and photos, and Schedule and progress.

Save a dated combined audit report, source snapshots/references and record fingerprints (including reviewed logs, photos and schedule records), a bill-by-bill review register, and an open-issues register spanning all three areas under financial-reviews/<project ID>/<review date>/ (use a new revision for same-day reruns). Preserve prior reviews, link resolved findings to evidence, and update latest.json and the index after verifying the saved files reopen. Save an internal report copy to the project's Files > Other through a supported Penney workflow and verify it appears; retain its file ID. Save durable process/location pointers in Penney memory, not changing balances. If saving or evidence access is unavailable, explain the exact gap and mark the audit partial.

Return a concise review with links to the saved audit and source records, changes since the prior review, verified balances versus estimates, and prioritized next steps. State coverage and unresolved evidence; do not claim everything is correct while gaps remain. Keep open issues visible for the next weekly review.

Project records are read-only: saving audit artifacts and continuity pointers is authorized, but do not edit daily logs, photos, schedules, phase statuses or financial records, confirm spending, send messages, issue invoices or make payments. Propose corrections with evidence for review. Any separately authorized follow-up client invoices must use the app invoice workflow and native PDF; vendor bills must use the existing Command Center bill workflow with duplicate review. Spending confirmation requires both a job and budget line. Do not create an automatic schedule.`;
  }

  const scope = `Review Weekly Close for ${context.label}, ${context.startDate} through ${context.endDate}, inclusive (America/New_York).\nPage: ${origin}${context.path}\nFlag missing receipts, unresolved bills, duplicates, incomplete job or budget-line allocations, and billing or collections items needing attention in this period.`;

  return `${scope}\n\nUse connected Penney tools and reliable Penney records; do not rely on QuickBooks. Read relevant Penney memory and workspace instructions. Fetch current records within my authorized access; if unavailable or incomplete, explain the gap rather than inventing figures. Cite records and distinguish verified balances from estimates.\n\nReturn a concise review with prioritized next steps. This is read-only: do not change records, send messages, or make payments. Any follow-up invoices must use the app invoice workflow and native PDF; vendor bills must use the existing Command Center bill workflow, including duplicate review. Spending confirmation requires both a job and budget line.`;
}

export function isAbsoluteWorkspace(path: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\/|\\\\[^\\]+\\[^\\]+)/.test(path.trim());
}

/** Documented desktop deep link. Prefills the composer; it does not submit. */
export function buildCodexReviewUrl(prompt: string, workspace: string): string {
  if (!prompt.trim() || !isAbsoluteWorkspace(workspace)) return "";
  return `codex://new?path=${encodeURIComponent(workspace.trim())}&prompt=${encodeURIComponent(prompt)}`;
}
