"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { PAYROLL_ROLES } from "@/lib/auth/role-access";
import { canSeeRate, getRateVisibility } from "@/lib/auth/rate-visibility";

/**
 * Payroll timesheet actions. Field time is stored in `daily_logs`
 * (one row per clock-in → clock-out). Payroll rolls those up per worker per
 * day, subtracting a break (default 30 min/day, overridable per person/day via
 * `payroll_adjustments`). Shannon can also correct a forgotten clock-out by
 * editing the entry's times.
 *
 * All reads/writes go through the service-role client and are gated to office
 * payroll roles in code (RLS on payroll_adjustments is defense-in-depth).
 */

const DEFAULT_BREAK_MINUTES = 30;
/** Day bucketing + display use the company's local timezone (North Shore, MA). */
const TZ = "America/New_York";

export interface PayrollEntry {
  id: string;
  clockIn: string;
  clockOut: string | null;
  status: string;
  rawMinutes: number;
  edited: boolean;
  autoClockedOut: boolean;
  projectId: string | null;
  projectName: string | null;
  projectNumber: string | null;
  /** The worker's own note on this shift (what they did). */
  note: string | null;
  /** Geofence verdict at clock-in: true on site, false off site, null unknown. */
  onSite: boolean | null;
}

/** A "Post update" daily log (kind=post) — field notes/photos, not clock time. */
export interface PayrollUpdate {
  id: string;
  at: string;
  text: string;
  projectName: string | null;
}

export interface PayrollDay {
  date: string; // YYYY-MM-DD (local)
  entries: PayrollEntry[];
  updates: PayrollUpdate[];
  rawMinutes: number;
  breakMinutes: number;
  paidMinutes: number;
  breakOverridden: boolean;
  hasOpen: boolean;
}

export interface PayrollWorker {
  profileId: string;
  employeeId: string | null;
  name: string;
  hourlyRate: number | null;
  days: PayrollDay[];
  totalRawMinutes: number;
  totalPaidMinutes: number;
  costCents: number;
}

export interface PayrollTimesheet {
  start: string;
  end: string;
  workers: PayrollWorker[];
  totals: {
    workerCount: number;
    paidMinutes: number;
    costCents: number;
    missingRateWorkers: number;
  };
}

/** YYYY-MM-DD for an instant, in the company timezone. */
function localDate(iso: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

async function requirePayroll() {
  const user = await getUser();
  const role = user?.profile?.role;
  if (!user || !role || !PAYROLL_ROLES.includes(role)) {
    return { error: "You don't have access to payroll." as const, user: null };
  }
  return { error: null, user };
}

/**
 * Build the timesheet for an inclusive local-date range [start, end]
 * (both YYYY-MM-DD).
 */
export async function getPayrollTimesheet(
  start: string,
  end: string,
): Promise<{ data?: PayrollTimesheet; error?: string }> {
  const gate = await requirePayroll();
  if (gate.error) return { error: gate.error };

  const supabase = createAdminClient();

  // Pad the UTC query window so no local-day rows are missed at the edges;
  // rows outside [start,end] get filtered out after local-date bucketing.
  const lowerUtc = `${start}T00:00:00-00:00`;
  const upperUtc = new Date(`${end}T23:59:59-00:00`);
  upperUtc.setUTCDate(upperUtc.getUTCDate() + 2);
  const lower = new Date(lowerUtc);
  lower.setUTCDate(lower.getUTCDate() - 1);

  const { data: logs, error: logsErr } = await supabase
    .from("daily_logs")
    .select(
      "id, author_id, started_at, ended_at, status, auto_clocked_out, edited_at, project_id, text, kind, clock_in_on_site",
    )
    .gte("started_at", lower.toISOString())
    .lt("started_at", upperUtc.toISOString())
    .order("started_at", { ascending: true });
  if (logsErr) return { error: logsErr.message };

  // Keep only logs whose local work-date falls in the requested range.
  const inRange = (logs ?? []).filter((l) => {
    const d = localDate(l.started_at);
    return d >= start && d <= end;
  });

  const authorIds = Array.from(new Set(inRange.map((l) => l.author_id)));
  if (authorIds.length === 0) {
    return {
      data: {
        start,
        end,
        workers: [],
        totals: { workerCount: 0, paidMinutes: 0, costCents: 0, missingRateWorkers: 0 },
      },
    };
  }

  // Resolve project names for the job chip on each entry.
  const projectIds = Array.from(
    new Set(inRange.map((l) => l.project_id).filter((id): id is string => !!id)),
  );
  const projByIdPromise =
    projectIds.length > 0
      ? supabase.from("projects").select("id, name, project_number").in("id", projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string; project_number: string | null }[] });

  // Resolve worker identity + rate (employees), with a profile name fallback.
  const [{ data: projs }, { data: emps }, { data: profiles }, { data: adjustments }] = await Promise.all([
    projByIdPromise,
    supabase
      .from("employees")
      .select("id, first_name, last_name, hourly_rate, profile_id")
      .in("profile_id", authorIds),
    supabase.from("profiles").select("id, full_name, email").in("id", authorIds),
    supabase
      .from("payroll_adjustments")
      .select("profile_id, work_date, break_minutes")
      .in("profile_id", authorIds)
      .gte("work_date", start)
      .lte("work_date", end),
  ]);

  const projById = new Map<string, { name: string; number: string | null }>();
  for (const p of projs ?? []) {
    projById.set(p.id, { name: p.name, number: p.project_number ?? null });
  }

  const empByProfile = new Map<string, { id: string; name: string; rate: number | null }>();
  for (const e of emps ?? []) {
    if (e.profile_id) {
      empByProfile.set(e.profile_id, {
        id: e.id,
        name: `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim(),
        rate: e.hourly_rate == null ? null : Number(e.hourly_rate),
      });
    }
  }
  const nameByProfile = new Map<string, string>();
  for (const p of profiles ?? []) {
    nameByProfile.set(p.id, (p.full_name || p.email || "Unknown").trim());
  }
  const overrideByKey = new Map<string, number>();
  for (const a of adjustments ?? []) {
    overrideByKey.set(`${a.profile_id}|${a.work_date}`, a.break_minutes);
  }

  // Group logs by worker → day. "Post update" logs (kind=post) are field
  // notes, not clock time — they ride along as updates, never as entries.
  type Acc = { entries: PayrollEntry[]; updates: PayrollUpdate[] };
  const byWorkerDay = new Map<string, Map<string, Acc>>();
  for (const l of inRange) {
    const day = localDate(l.started_at);
    let days = byWorkerDay.get(l.author_id);
    if (!days) {
      days = new Map();
      byWorkerDay.set(l.author_id, days);
    }
    const acc = days.get(day) ?? { entries: [], updates: [] };
    const proj = l.project_id ? projById.get(l.project_id) : undefined;

    if (l.kind === "post") {
      if (l.text?.trim()) {
        acc.updates.push({
          id: l.id,
          at: l.started_at,
          text: l.text.trim(),
          projectName: proj?.name ?? null,
        });
      }
      days.set(day, acc);
      continue;
    }

    const rawMs =
      l.ended_at ? new Date(l.ended_at).getTime() - new Date(l.started_at).getTime() : 0;
    acc.entries.push({
      id: l.id,
      clockIn: l.started_at,
      clockOut: l.ended_at,
      status: l.status,
      rawMinutes: Math.max(0, Math.round(rawMs / 60000)),
      edited: !!l.edited_at,
      autoClockedOut: !!l.auto_clocked_out,
      projectId: l.project_id ?? null,
      projectName: proj?.name ?? null,
      projectNumber: proj?.number ?? null,
      note: l.text?.trim() || null,
      onSite: l.clock_in_on_site ?? null,
    });
    days.set(day, acc);
  }

  const workers: PayrollWorker[] = [];
  let grandPaid = 0;
  let grandCost = 0;
  let missingRateWorkers = 0;

  for (const profileId of authorIds) {
    const daysMap = byWorkerDay.get(profileId);
    if (!daysMap) continue;
    const emp = empByProfile.get(profileId);
    const rate = emp?.rate ?? null;
    const name = emp?.name || nameByProfile.get(profileId) || "Unknown";

    const days: PayrollDay[] = [];
    let totalRaw = 0;
    let totalPaid = 0;

    for (const [date, acc] of [...daysMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const rawMinutes = acc.entries.reduce((s, e) => s + e.rawMinutes, 0);
      const hasOpen = acc.entries.some((e) => !e.clockOut);
      const key = `${profileId}|${date}`;
      const overridden = overrideByKey.has(key);
      // Only deduct a break when there is completed work to deduct it from.
      const rawBreak = overridden ? overrideByKey.get(key)! : DEFAULT_BREAK_MINUTES;
      const breakMinutes = rawMinutes > 0 ? Math.min(rawBreak, rawMinutes) : 0;
      const paidMinutes = Math.max(0, rawMinutes - breakMinutes);
      days.push({
        date,
        entries: acc.entries,
        updates: acc.updates,
        rawMinutes,
        breakMinutes,
        paidMinutes,
        breakOverridden: overridden,
        hasOpen,
      });
      totalRaw += rawMinutes;
      totalPaid += paidMinutes;
    }

    const costCents = rate != null ? Math.round((totalPaid / 60) * rate * 100) : 0;
    if (rate == null) missingRateWorkers++;
    grandPaid += totalPaid;
    grandCost += costCents;

    workers.push({
      profileId,
      employeeId: emp?.id ?? null,
      name,
      hourlyRate: rate,
      days,
      totalRawMinutes: totalRaw,
      totalPaidMinutes: totalPaid,
      costCents,
    });
  }

  workers.sort((a, b) => a.name.localeCompare(b.name));

  // Payroll viewers outside the office-rate set (office admin = Howie) keep
  // hours for everyone but lose rate + cost on office-team rows; totals are
  // rebuilt from what's visible so nothing can be backed out.
  const vis = await getRateVisibility(gate.user);
  if (!vis.viewAll) {
    for (const w of workers) {
      if (
        !canSeeRate(vis, { profileId: w.profileId, employeeId: w.employeeId })
      ) {
        w.hourlyRate = null;
        w.costCents = 0;
      }
    }
    grandCost = workers.reduce((s, w) => s + w.costCents, 0);
    missingRateWorkers = workers.filter((w) => w.hourlyRate == null).length;
  }

  return {
    data: {
      start,
      end,
      workers,
      totals: {
        workerCount: workers.length,
        paidMinutes: grandPaid,
        costCents: grandCost,
        missingRateWorkers,
      },
    },
  };
}

/** Set (or clear) the break override for one worker on one local day. */
export async function setPayrollBreak(
  profileId: string,
  workDate: string,
  breakMinutes: number,
): Promise<{ success?: true; error?: string }> {
  const gate = await requirePayroll();
  if (gate.error) return { error: gate.error };

  const mins = Math.round(Number(breakMinutes));
  if (!Number.isFinite(mins) || mins < 0 || mins > 720) {
    return { error: "Break must be between 0 and 720 minutes." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return { error: "Invalid date." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("payroll_adjustments").upsert(
    {
      profile_id: profileId,
      work_date: workDate,
      break_minutes: mins,
      updated_by: gate.user!.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,work_date" },
  );
  if (error) return { error: error.message };

  revalidatePath("/crew-admin");
  return { success: true };
}

/**
 * Correct a clock entry's times (e.g. a forgotten clock-out). Pass clockOut
 * null to leave a shift open. Records who edited it and when.
 */
export async function updateTimeEntry(
  logId: string,
  clockInIso: string,
  clockOutIso: string | null,
): Promise<{ success?: true; error?: string }> {
  const gate = await requirePayroll();
  if (gate.error) return { error: gate.error };

  const inMs = new Date(clockInIso).getTime();
  if (Number.isNaN(inMs)) return { error: "Invalid clock-in time." };
  let outIso: string | null = null;
  if (clockOutIso) {
    const outMs = new Date(clockOutIso).getTime();
    if (Number.isNaN(outMs)) return { error: "Invalid clock-out time." };
    if (outMs <= inMs) return { error: "Clock-out must be after clock-in." };
    outIso = new Date(outMs).toISOString();
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("daily_logs")
    .update({
      started_at: new Date(inMs).toISOString(),
      ended_at: outIso,
      status: outIso ? "completed" : "in_progress",
      // A manual correction supersedes any auto clock-out.
      auto_clocked_out: false,
      edited_by: gate.user!.id,
      edited_at: new Date().toISOString(),
    })
    .eq("id", logId);
  if (error) return { error: error.message };

  revalidatePath("/crew-admin");
  return { success: true };
}
