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
  "/bids",
  "/bid-requests",
  "/proposals",
  "/vendors",
  "/employees",
  "/crm",
  "/settings",
  "/command-center/reviews",
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
 * Proposal reviews (/command-center/reviews + approval actions): owners
 * (Ryan, Shannon, Nicole) and precon (Jorge). PMs, office admins, and field
 * are out.
 */
export const ESTIMATE_REVIEW_ROLES: readonly string[] = [
  "owner",
  "precon_manager",
];

export function canReviewEstimates(role: UserRole | string | null | undefined): boolean {
  return !!role && ESTIMATE_REVIEW_ROLES.includes(role);
}

/**
 * Who may see office-team + Howie pay (any employee linked to a non-field
 * profile): owners + precon only — Ryan, Shannon, Nicole, Jorge. Field-crew
 * rates are not restricted; everyone always sees their own rate.
 */
export const OFFICE_RATE_VIEWER_ROLES: readonly string[] = [
  "owner",
  "precon_manager",
];

export function canViewOfficeRates(role: UserRole | string | null | undefined): boolean {
  return !!role && OFFICE_RATE_VIEWER_ROLES.includes(role);
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
  if (
    pathname === "/command-center/reviews" ||
    pathname.startsWith("/command-center/reviews/")
  ) {
    return canReviewEstimates(viewer.role);
  }
  if (!isProjectScopedRole(viewer.role)) return true;
  if (PM_BLOCKED_PROJECT_SUBPAGES.test(pathname)) return false;
  return !PM_BLOCKED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
