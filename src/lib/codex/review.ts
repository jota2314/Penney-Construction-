export type ReviewFocus = "status" | "closeout" | "unsure";

export type ReviewContext =
  | { kind: "weekly"; label: string; startDate: string; endDate: string; path: string }
  | { kind: "job"; projectId: string; focus?: ReviewFocus };

// Override per device in the review panel when using another computer. Shared by Codex and Claude.
export const DEFAULT_CODEX_WORKSPACE = "C:\\Users\\rajat\\Penney Construction";

export function buildFinalAuditPath(projectId: string): string {
  return `/finances?auditProject=${encodeURIComponent(projectId)}#projects`;
}

export function buildReviewPrompt(context: ReviewContext, origin: string): string {
  if (context.kind === "job") {
    const focus = context.focus ?? "status";
    const intent = focus === "closeout"
      ? `Perform the final job audit and carry it through the existing native final-audit flow when the evidence supports financial closure. Establish physical completion separately from financial closeout. If the job cannot close, explain the exact remaining blockers and the next action for each; do not claim it is closed just because a review was saved.`
      : focus === "unsure"
        ? "I am unsure whether this job needs an active-job check or final closeout. Establish the stage from current evidence and tell me what matters next. Ask one focused question only if the records cannot resolve consequential uncertainty."
        : "Review the current job status. Tell me where the job stands and whether the evidence points to active work or closeout; do not assume I requested finalization. Ask one focused question only if the records cannot resolve consequential uncertainty.";
    const closeout = focus === "closeout" ? `

Reconcile the signed contract, approved changes, allowance credits, native client invoices and net customer receipts. Count bounced-check reversals once and replacement receipts once; distinguish recorded receipts from bank-cleared proof. Do not count bonuses or training reimbursements as customer income. Keep uncollected revenue and unpaid bills visible separately from profit.

Verify spending by job scope: net vendor/material/subcontractor costs, credits, crew hours and the shared labor model, remaining work and unbilled obligations. Reconcile payroll and add only additional burden not already included. Use actual company overhead recorded in the system and its supported allocation basis; never substitute a flat 15% allowance or count an existing cost twice. Missing payroll or overhead evidence is a blocker, not zero cost. Show final revenue, job spend, additional payroll burden, allocated overhead, total final cost, net profit and margin, with the basis of every allocation.

Verify final work, permits/inspections and client acceptance. Save the evidence-backed final report as an accessible, versioned file in this project's Files. Finish through the existing native final-audit approval flow at ${origin}${buildFinalAuditPath(context.projectId)}, using the reviewed report and current readiness checks. A reviewer must approve the concrete final figures there. Verify the saved final record and financial closure afterward; retain prior audit history and reopen through that same flow if new activity requires a revision. Review is not closure, and auditing does not authorize changing ledger entries.

After verifying the saved native final closure, prepare the team's final-audit results email using only Penney MCP send_email. Do not compose or send final-results email while the job is blocked, reopened or not financially closed. Verify the intended internal finance recipients from actual current project/team records and their access to job financials; do not infer recipients from the company domain or a crew mailing list. Use the approved immutable final record for final revenue, net receipts, direct job costs, additional payroll burden, actual allocated overhead, total final cost, net profit and margin, remaining receivables/payables, and the final report link. Check saved email IDs first to avoid duplicate sends for the same final record.

Use send_email with the exact recipients, subject, body, project_id and approved report file_ids if attaching it; this parks a draft and does not send. Show the full parked To/Cc/Subject/Body and attachments in chat, then wait for fresh explicit approval of that exact draft, as required by Penney memory 44d71aa6-8168-4aaf-beb2-6c2be224cca1. Only after approval call send_email with that draft_id. Recheck that the approved final record is still current before confirming; if closure or figures changed, stop and re-review. If the draft changes, show the replacement and get fresh approval. If Penney MCP fails or is unavailable, report the blocker; never use Gmail/Outlook, browser sending, SMTP or an app/API fallback. Report whether the email is drafted, awaiting approval, sent or failed, and save the final-record ID, draft ID and confirmed message ID/outcome in the audit baseline. Never claim sent without a successful tool result. This is an assisted review step, not an automatic app email.` : "";
    const messageBoundary = focus === "closeout"
      ? "The final-results email draft and approved send described above are the only messaging actions authorized by this closeout review."
      : "Do not send messages.";
    return `Review Penney project ID ${context.projectId} using get_job_review first.
Page: ${origin}/projects/${encodeURIComponent(context.projectId)}?tab=finances

${intent} Use the recorded status and current evidence. Do not guess physical completion from spending or schedule percentages.

Use the shared app/MCP result within my authorized access; do not rely on QuickBooks. Lead with the job name and stage, recorded cost versus budget, collections and whether final profit is verified. Show every over-budget line with budget, cost, hours and dollars over. Clearly separate recorded overruns, disputed allocations, missing budgets and forecast risks. Give the three most useful next actions. Keep the answer under 250 words outside the table, with supporting record IDs and details in the saved review/drill-down.

For more evidence use inspect_job_finding. Compare the saved baseline, inspect changed evidence and unresolved issues, and retain unchanged verified sources. Read FINANCIAL_REVIEW_WORKFLOW.md for deeper audits. Save evidence through save_job_review_evidence. If the tools are unavailable, say what is missing; do not silently start another exhaustive audit or substitute stale balances.
${closeout}

This review is read-only for business records. ${messageBoundary} Do not create invoices, change budgets or make payments. For a separately authorized correction, inspect the original source, preview the exact change with preview_job_correction, then apply_job_correction only within that authorization and verify refreshed totals. Never increase a budget just to remove an overrun.`;
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

/** Claude desktop deep link: opens a new Code session in the folder with the prompt prefilled. */
export function buildClaudeReviewUrl(prompt: string, workspace: string): string {
  if (!prompt.trim() || !isAbsoluteWorkspace(workspace)) return "";
  return `claude://code/new?folder=${encodeURIComponent(workspace.trim())}&q=${encodeURIComponent(prompt)}`;
}
