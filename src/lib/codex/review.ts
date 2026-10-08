export type ReviewContext =
  | { kind: "weekly"; label: string; startDate: string; endDate: string; path: string }
  | { kind: "job"; projectId: string };

// Override per device in the review panel when using another computer.
export const DEFAULT_CODEX_WORKSPACE = "C:\\Users\\rajat\\Penney Construction";

export function buildReviewPrompt(context: ReviewContext, origin: string): string {
  if (context.kind === "job") {
    return `Review Penney project ID ${context.projectId} using get_job_review first.
Page: ${origin}/projects/${encodeURIComponent(context.projectId)}?tab=finances

Tell me where the job stands and whether this is an active-job check or closeout. Use the recorded status and current evidence; if uncertain, say so and ask one focused question. Do not guess physical completion from spending or schedule percentages.

Use the shared app/MCP result within my authorized access; do not rely on QuickBooks. Lead with the job name and stage, recorded cost versus budget, collections and whether final profit is verified. Show every over-budget line with budget, cost, hours and dollars over. Clearly separate recorded overruns, disputed allocations, missing budgets and forecast risks. Give the three most useful next actions. Keep the answer under 250 words outside the table, with supporting record IDs and details in the saved review/drill-down.

For more evidence use inspect_job_finding. Compare the saved baseline, inspect changed evidence and unresolved issues, and retain unchanged verified sources. Read FINANCIAL_REVIEW_WORKFLOW.md for deeper audits. Save evidence through save_job_review_evidence. If the tools are unavailable, say what is missing; do not silently start another exhaustive audit or substitute stale balances.

This review is read-only for business records. Do not send messages, create invoices, change budgets or make payments. For a separately authorized correction, inspect the original source, preview the exact change with preview_job_correction, then apply_job_correction only within that authorization and verify refreshed totals. Never increase a budget just to remove an overrun.`;
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
