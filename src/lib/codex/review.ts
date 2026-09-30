export type ReviewContext =
  | { kind: "weekly"; label: string; startDate: string; endDate: string; path: string }
  | { kind: "job"; projectId: string };

// Override per device in the review panel when using another computer.
export const DEFAULT_CODEX_WORKSPACE = "C:\\Users\\rajat\\Penney Construction";

export function buildReviewPrompt(context: ReviewContext, origin: string): string {
  const scope = context.kind === "weekly"
    ? `Review Weekly Close for ${context.label}, ${context.startDate} through ${context.endDate}, inclusive (America/New_York).\nPage: ${origin}${context.path}\nFlag missing receipts, unresolved bills, duplicates, incomplete job or budget-line allocations, and billing or collections items needing attention in this period.`
    : `Review job financials for Penney project ID ${context.projectId}.\nPage: ${origin}/projects/${encodeURIComponent(context.projectId)}?tab=finances\nResolve the job name from its ID. Review budget versus costs, commitments, labor, change orders, client billing, payments received, and outstanding collections. Avoid double-counting commitments, bills, or labor.`;

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
