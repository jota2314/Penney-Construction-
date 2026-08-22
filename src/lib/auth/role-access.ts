import type { UserRole } from "@/types/auth";

/**
 * Route prefixes hidden from and blocked for project managers. PMs run their
 * assigned jobs — they don't get company financials, estimating/pricing,
 * owner dashboards, or app settings. Enforced in middleware (redirect) and
 * used to filter the sidebar/mobile nav.
 */
export const PM_BLOCKED_PREFIXES: readonly string[] = [
  "/ceo",
  "/estimates",
  "/cost-book",
  "/spent",
  "/payments",
  "/overhead",
  "/week",
  "/bids",
  "/bid-requests",
  "/proposals",
  "/vendors",
  "/employees",
  "/crm",
  "/settings",
  "/command-center/agents",
  "/hiring",
];

/**
 * Project sub-pages with company pricing/markup that PMs must not open even
 * on their own jobs (estimate build-ups expose margins).
 */
export const PM_BLOCKED_PROJECT_SUBPAGES = /^\/projects\/[^/]+\/(estimates|pricing|bids)(\/|$)/;

/**
 * Roles allowed to see and edit payroll (pay rates + editable hours):
 * owner, office admin, and precon manager (Jorge). Enforced in the payroll
 * server actions, the Crew Management tab, and the payroll_adjustments RLS.
 */
export const PAYROLL_ROLES: readonly string[] = [
  "owner",
  "office_admin",
  "precon_manager",
];

export function canViewPayroll(role: UserRole | string | null | undefined): boolean {
  return !!role && PAYROLL_ROLES.includes(role);
}

/**
 * The CEO dashboard is Jorge-only — an explicit email allowlist, not a role
 * check, because `owner` also covers Ryan, Nicole, and Shannon and they are
 * deliberately excluded.
 */
export const CEO_DASHBOARD_EMAILS: readonly string[] = [
  "jbetancur@penneyconstructioninc.com",
  "jorgebetancurfx@gmail.com",
];

export function canViewCeoDashboard(email: string | null | undefined): boolean {
  if (!email) return false;
  return CEO_DASHBOARD_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Who can approve a vendor bill for payment. PMs (Howie, Bill) file the
 * invoices; Jorge or Ryan approve; Nicole pays. An email allowlist because
 * `owner` also covers Nicole and Shannon, and the approver must not be the
 * same person who pays.
 */
export const BILL_PAY_APPROVER_EMAILS: readonly string[] = [
  "jbetancur@penneyconstructioninc.com",
  "jorgebetancurfx@gmail.com",
  "rpenney@penneyconstructioninc.com",
];

export function canApproveBillPay(email: string | null | undefined): boolean {
  if (!email) return false;
  return BILL_PAY_APPROVER_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * EOS (/eos) is the leadership team only — Rocks and the Scorecard carry
 * revenue, margin and cash numbers. An email allowlist, not a role check,
 * for the same reason the CEO dashboard uses one: roles don't line up with
 * the leadership team. Howie runs Operations but carries `field`, the same
 * role as every carpenter, and `owner` covers people either way.
 *
 * Keep this list in step with the `eos_team_members` rows — that table is the
 * real gate (all 13 `eos_*` tables have RLS policies keyed to it). This
 * allowlist only decides whether the nav item shows and middleware lets the
 * route through. Jorge is here twice on purpose: he signs in with the gmail
 * account, and both of his profiles are seated.
 */
export const EOS_TEAM_EMAILS: readonly string[] = [
  "rpenney@penneyconstructioninc.com",
  "jbetancur@penneyconstructioninc.com",
  "jorgebetancurfx@gmail.com",
  "nsmith@penneyconstructioninc.com",
  "hclick@penneyconstructioninc.com",
  "bcrowley@penneyconstructioninc.com",
  "spenney@penneyconstructioninc.com",
];

export function canViewEos(email: string | null | undefined): boolean {
  if (!email) return false;
  return EOS_TEAM_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * The design studio (/design) is Jorge's personal sandbox — not a company
 * feature. A design in there is an unfinished idea: wrong tile, a layout that
 * was tried and abandoned, a room priced before anyone measured it. None of
 * that should reach the team, let alone a client.
 *
 * An email allowlist rather than a role check, for the same reason the CEO
 * dashboard uses one: `owner` also covers Ryan, Nicole and Shannon, and
 * `precon_manager` would hand the sandbox to any future estimator. Jorge is
 * listed twice on purpose — he signs in with either account.
 *
 * This gates the nav item, middleware, and the pages. The real boundary is RLS:
 * all four `bathroom_design*` / `design_materials` tables are keyed to these
 * two auth uids via `is_design_studio_owner()`, so even a direct API call with
 * someone else's token returns nothing.
 */
export const DESIGN_STUDIO_EMAILS: readonly string[] = [
  "jbetancur@penneyconstructioninc.com",
  "jorgebetancurfx@gmail.com",
];

export function canViewDesignStudio(email: string | null | undefined): boolean {
  if (!email) return false;
  return DESIGN_STUDIO_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * The job board (/board) is Jorge's private planning table — projects down the
 * left, dates across the top, with an AI read on each job's health. Same
 * email-allowlist reasoning as the design studio: this is a personal working
 * surface, not a company feature, and a role check would leak it to Ryan or
 * any future precon hire.
 */
export const JOB_BOARD_EMAILS: readonly string[] = [
  "jbetancur@penneyconstructioninc.com",
  "jorgebetancurfx@gmail.com",
];

export function canViewJobBoard(email: string | null | undefined): boolean {
  if (!email) return false;
  return JOB_BOARD_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Owners (Ryan, Shannon, Nicole) and precon (Jorge). PMs, office admins, and
 * field are out. Used for contract countersignature — the proposal review
 * queue this originally gated was removed 7/30 when Jorge started sending
 * proposals to clients directly.
 */
export const ESTIMATE_REVIEW_ROLES: readonly string[] = [
  "owner",
  "precon_manager",
];

export function canReviewEstimates(role: UserRole | string | null | undefined): boolean {
  return !!role && ESTIMATE_REVIEW_ROLES.includes(role);
}

/**
 * Who may see office-team pay (any employee linked to a non-field profile):
 * owners + precon only — Ryan, Shannon, Nicole, Jorge. Field-crew rates are
 * not restricted; everyone always sees their own rate. People on
 * HIDDEN_PAY_EMAILS below are stricter still — masked even for these roles.
 */
export const OFFICE_RATE_VIEWER_ROLES: readonly string[] = [
  "owner",
  "precon_manager",
];

export function canViewOfficeRates(role: UserRole | string | null | undefined): boolean {
  return !!role && OFFICE_RATE_VIEWER_ROLES.includes(role);
}

/**
 * People whose pay is hidden from EVERYONE in the app — owners, precon,
 * payroll viewers, and the person themselves included. Jorge's 8/12 request:
 * take Howie's pay off the crew screens, nobody should see it. Stricter than
 * the office-rate protection above (which still shows those rates to owners
 * + precon).
 *
 * Matched against BOTH `profiles.email` and `employees.email` inside
 * getRateVisibility, so an unlinked row still hides. Hours stay visible
 * everywhere (payroll still needs them) — only rate, per-person cost, and
 * earnings go. Blended multi-worker totals (project labor, today's burn)
 * still include their cost; per-person rows never do, and displayed payroll
 * totals are rebuilt from visible rows so the hidden pay can't be backed out.
 *
 * Note: the rate also becomes read-only in the app for everyone (the edit
 * forms hold the masked empty value, so writes are dropped to avoid wiping
 * the real rate). Change it in the database directly if it ever changes.
 */
export const HIDDEN_PAY_EMAILS: readonly string[] = [
  "hclick@penneyconstructioninc.com",
];

export function isHiddenPayEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return HIDDEN_PAY_EMAILS.includes(email.trim().toLowerCase());
}

/** Effective (impersonation-aware) identity for path checks. */
export interface AccessViewer {
  role?: UserRole | string | null;
  email?: string | null;
}

/** Roles whose project lists are scoped to their own assignments. */
export function isProjectScopedRole(role: UserRole | string | null | undefined): boolean {
  return role === "project_manager";
}

export function canAccessPath(
  viewer: AccessViewer,
  pathname: string,
): boolean {
  if (pathname === "/ceo" || pathname.startsWith("/ceo/")) {
    return canViewCeoDashboard(viewer.email);
  }
  if (pathname === "/eos" || pathname.startsWith("/eos/")) {
    return canViewEos(viewer.email);
  }
  if (pathname === "/design" || pathname.startsWith("/design/")) {
    return canViewDesignStudio(viewer.email);
  }
  if (pathname === "/board" || pathname.startsWith("/board/")) {
    return canViewJobBoard(viewer.email);
  }
  if (!isProjectScopedRole(viewer.role)) return true;
  if (PM_BLOCKED_PROJECT_SUBPAGES.test(pathname)) return false;
  return !PM_BLOCKED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
