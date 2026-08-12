import { getUser } from "./get-user";
import {
  HIDDEN_PAY_EMAILS,
  canViewOfficeRates,
  isHiddenPayEmail,
} from "./role-access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthUser } from "@/types/auth";

/**
 * Pay-rate visibility. Two tiers:
 *
 * 1. "Protected" pay = any employee linked to a non-field profile (the office
 *    team). Only owners + precon (Ryan, Shannon, Nicole, Jorge) see those
 *    rates; everyone always sees their own. Field-crew rates are
 *    unrestricted — PMs need them to run jobs.
 * 2. "Hidden" pay (HIDDEN_PAY_EMAILS in role-access — Howie) = masked for
 *    EVERY viewer, owners + precon and the person themselves included.
 *    Nobody sees it anywhere in the app.
 *
 * Use getRateVisibility() once per request, then canSeeRate() per row, and
 * null out hourly_rate (and rate-derived per-person values) when it's false.
 */
export interface RateVisibility {
  viewAll: boolean;
  selfProfileId: string | null;
  selfEmployeeId: string | null;
  protectedEmployeeIds: ReadonlySet<string>;
  protectedProfileIds: ReadonlySet<string>;
  /** Pay masked for every viewer, viewAll and self included. */
  hiddenEmployeeIds: ReadonlySet<string>;
  hiddenProfileIds: ReadonlySet<string>;
}

export async function getRateVisibility(
  viewer?: AuthUser | null,
): Promise<RateVisibility> {
  const user = viewer === undefined ? await getUser() : viewer;
  const selfProfileId = user?.profile?.id ?? user?.id ?? null;
  const viewAll = canViewOfficeRates(user?.profile?.role);

  // Office-rate viewers can only skip the lookup when there is no hidden-pay
  // list to resolve — hidden people are masked even for them.
  if (viewAll && HIDDEN_PAY_EMAILS.length === 0) {
    return {
      viewAll: true,
      selfProfileId,
      selfEmployeeId: null,
      protectedEmployeeIds: new Set(),
      protectedProfileIds: new Set(),
      hiddenEmployeeIds: new Set(),
      hiddenProfileIds: new Set(),
    };
  }

  // Small tables — load both maps in one round trip. Admin client so the
  // check can't be weakened by RLS differences between callers.
  const admin = createAdminClient();
  const [{ data: profiles }, { data: employees }] = await Promise.all([
    admin.from("profiles").select("id, role, email"),
    admin.from("employees").select("id, profile_id, email"),
  ]);

  const protectedProfileIds = new Set<string>();
  const hiddenProfileIds = new Set<string>();
  for (const p of profiles ?? []) {
    if (p.role && p.role !== "field") protectedProfileIds.add(p.id);
    if (isHiddenPayEmail(p.email)) hiddenProfileIds.add(p.id);
  }

  const protectedEmployeeIds = new Set<string>();
  const hiddenEmployeeIds = new Set<string>();
  let selfEmployeeId: string | null = null;
  for (const e of employees ?? []) {
    if (isHiddenPayEmail(e.email)) hiddenEmployeeIds.add(e.id);
    if (!e.profile_id) continue;
    if (selfProfileId && e.profile_id === selfProfileId) selfEmployeeId = e.id;
    if (protectedProfileIds.has(e.profile_id)) protectedEmployeeIds.add(e.id);
    if (hiddenProfileIds.has(e.profile_id)) hiddenEmployeeIds.add(e.id);
  }
  // Link back the other way too, so profile-keyed surfaces (payroll, project
  // labor) mask even when only the employee row's email matched.
  for (const e of employees ?? []) {
    if (e.profile_id && hiddenEmployeeIds.has(e.id)) {
      hiddenProfileIds.add(e.profile_id);
    }
  }

  return {
    viewAll,
    selfProfileId,
    selfEmployeeId,
    protectedEmployeeIds,
    protectedProfileIds,
    hiddenEmployeeIds,
    hiddenProfileIds,
  };
}

/**
 * Mask employee rates on CompatTimeEntry-shaped rows (crew-admin, live map,
 * feed, phase financials all share this shape). Never call from cron/system
 * paths — there's no viewer there, so everything would mask.
 */
export function maskTimeEntryRates<
  T extends {
    employee_id: string | null;
    employees: {
      first_name: string;
      last_name: string;
      hourly_rate: number | null;
    } | null;
  },
>(v: RateVisibility, entries: T[]): T[] {
  if (v.viewAll && v.hiddenEmployeeIds.size === 0) return entries;
  return entries.map((t) =>
    t.employees &&
    t.employee_id &&
    !canSeeRate(v, { employeeId: t.employee_id })
      ? { ...t, employees: { ...t.employees, hourly_rate: null } }
      : t,
  );
}

/** True when this viewer may see the pay rate of the given person. */
export function canSeeRate(
  v: RateVisibility,
  ref: { employeeId?: string | null; profileId?: string | null },
): boolean {
  // Hidden-pay people are masked for everyone — before viewAll and self.
  if (ref.employeeId && v.hiddenEmployeeIds.has(ref.employeeId)) return false;
  if (ref.profileId && v.hiddenProfileIds.has(ref.profileId)) return false;
  if (v.viewAll) return true;
  if (ref.profileId && v.selfProfileId && ref.profileId === v.selfProfileId) {
    return true;
  }
  if (
    ref.employeeId &&
    v.selfEmployeeId &&
    ref.employeeId === v.selfEmployeeId
  ) {
    return true;
  }
  if (ref.employeeId && v.protectedEmployeeIds.has(ref.employeeId)) {
    return false;
  }
  if (ref.profileId && v.protectedProfileIds.has(ref.profileId)) return false;
  return true;
}
