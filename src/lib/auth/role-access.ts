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
];

/**
 * Project sub-pages with company pricing/markup that PMs must not open even
 * on their own jobs (estimate build-ups expose margins).
 */
export const PM_BLOCKED_PROJECT_SUBPAGES = /^\/projects\/[^/]+\/(estimates|pricing|bids)(\/|$)/;

/** Roles whose project lists are scoped to their own assignments. */
export function isProjectScopedRole(role: UserRole | string | null | undefined): boolean {
  return role === "project_manager";
}

export function canAccessPath(
  role: UserRole | string | null | undefined,
  pathname: string,
): boolean {
  if (!isProjectScopedRole(role)) return true;
  if (PM_BLOCKED_PROJECT_SUBPAGES.test(pathname)) return false;
  return !PM_BLOCKED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
