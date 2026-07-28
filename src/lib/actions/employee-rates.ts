"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { PAYROLL_ROLES } from "@/lib/auth/role-access";
import { canSeeRate, getRateVisibility } from "@/lib/auth/rate-visibility";

/**
 * Hourly-rate editing from Crew Management (roster + payroll).
 *
 * The live rate is `employees.hourly_rate`; every change also appends a row to
 * `employee_rate_changes` so a raise has a paper trail (who, when, why).
 *
 * IMPORTANT — labor cost is computed from the CURRENT rate everywhere
 * (payroll, live map, phase financials). Changing a rate therefore re-costs
 * past hours too. That is what you want for a *correction*; for a *raise* it
 * means old weeks shift as well. Effective-dated costing is not implemented —
 * the `effective_date` here is recorded for the audit trail only.
 */

const MAX_RATE = 500;

export interface RateChange {
  id: string;
  previousRate: number | null;
  newRate: number | null;
  effectiveDate: string;
  kind: "raise" | "decrease" | "correction" | "initial";
  reason: string | null;
  changedByName: string | null;
  createdAt: string;
}

async function requireRateEditor() {
  const user = await getUser();
  const role = user?.profile?.role;
  if (!user || !role || !PAYROLL_ROLES.includes(role)) {
    return { error: "You don't have access to pay rates." as const, user: null };
  }
  return { error: null, user };
}

/**
 * Set (or clear) an employee's hourly rate and log the change.
 *
 * @param newRate  dollars/hour, or null to clear the rate
 * @param kind     'raise' | 'decrease' | 'correction' — 'correction' means the
 *                 old number was simply wrong, so history should read as if the
 *                 new rate was always in effect.
 */
export async function setEmployeeHourlyRate(
  employeeId: string,
  newRate: number | null,
  opts?: { reason?: string; effectiveDate?: string; kind?: RateChange["kind"] },
): Promise<{ success?: true; error?: string; newRate?: number | null }> {
  const gate = await requireRateEditor();
  if (gate.error) return { error: gate.error };

  let rate: number | null = null;
  if (newRate != null && `${newRate}` !== "") {
    rate = Math.round(Number(newRate) * 100) / 100;
    if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) {
      return { error: `Rate must be between $0 and $${MAX_RATE}/hr.` };
    }
  }

  const effectiveDate = opts?.effectiveDate?.trim() || null;
  if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return { error: "Invalid effective date." };
  }

  const supabase = createAdminClient();

  const { data: employee, error: readErr } = await supabase
    .from("employees")
    .select("id, first_name, last_name, hourly_rate, profile_id")
    .eq("id", employeeId)
    .single();
  if (readErr || !employee) return { error: "Employee not found." };

  // A payroll viewer who can't SEE this person's rate can't change it either
  // (office-team pay is owners + precon only).
  const vis = await getRateVisibility(gate.user);
  if (
    !canSeeRate(vis, { employeeId: employee.id, profileId: employee.profile_id })
  ) {
    return { error: "You don't have access to this person's pay rate." };
  }

  const previousRate =
    employee.hourly_rate == null ? null : Number(employee.hourly_rate);
  if (previousRate === rate) return { success: true, newRate: rate };

  const { error: updateErr } = await supabase
    .from("employees")
    .update({ hourly_rate: rate })
    .eq("id", employeeId);
  if (updateErr) return { error: updateErr.message };

  const kind =
    opts?.kind ??
    (previousRate == null
      ? "initial"
      : rate != null && rate > previousRate
        ? "raise"
        : "decrease");

  // History is a nice-to-have — never fail the rate change because the log
  // insert did.
  const { error: logErr } = await supabase.from("employee_rate_changes").insert({
    employee_id: employeeId,
    previous_rate: previousRate,
    new_rate: rate,
    effective_date: effectiveDate ?? new Date().toISOString().slice(0, 10),
    kind,
    reason: opts?.reason?.trim() || null,
    changed_by: gate.user!.profile?.id ?? gate.user!.id,
  });
  if (logErr) console.error("[employee-rates] history insert failed:", logErr);

  revalidatePath("/crew-admin");
  revalidatePath("/employees");
  revalidatePath("/team");
  return { success: true, newRate: rate };
}

/** Rate change history for one employee, newest first. */
export async function listEmployeeRateHistory(
  employeeId: string,
): Promise<{ data?: RateChange[]; error?: string }> {
  const gate = await requireRateEditor();
  if (gate.error) return { error: gate.error };

  const supabase = createAdminClient();

  const { data: employee } = await supabase
    .from("employees")
    .select("id, profile_id")
    .eq("id", employeeId)
    .single();
  if (!employee) return { error: "Employee not found." };

  const vis = await getRateVisibility(gate.user);
  if (
    !canSeeRate(vis, { employeeId: employee.id, profileId: employee.profile_id })
  ) {
    return { error: "You don't have access to this person's pay rate." };
  }

  const { data, error } = await supabase
    .from("employee_rate_changes")
    .select("id, previous_rate, new_rate, effective_date, kind, reason, changed_by, created_at")
    .eq("employee_id", employeeId)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };

  const actorIds = Array.from(
    new Set((data ?? []).map((r) => r.changed_by).filter(Boolean) as string[]),
  );
  const nameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", actorIds);
    for (const p of profiles ?? []) {
      nameById.set(p.id, (p.full_name || p.email || "Unknown").trim());
    }
  }

  return {
    data: (data ?? []).map((r) => ({
      id: r.id,
      previousRate: r.previous_rate == null ? null : Number(r.previous_rate),
      newRate: r.new_rate == null ? null : Number(r.new_rate),
      effectiveDate: r.effective_date,
      kind: r.kind as RateChange["kind"],
      reason: r.reason,
      changedByName: r.changed_by ? (nameById.get(r.changed_by) ?? null) : null,
      createdAt: r.created_at,
    })),
  };
}
