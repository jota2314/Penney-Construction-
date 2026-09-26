/** Shared modeled wages, not an ADP payroll register. All amounts are cents. */
export type ClockRow = {
  id: string; author_id: string; started_at: string; ended_at: string | null;
  kind?: string | null; status?: string; project_id?: string | null;
};
export type RateChange = { employee_id: string; effective_date: string; new_rate: number | string; previous_rate: number | string | null };
export type LaborEmployee = { id: string; profile_id: string | null; hourly_rate: number | string | null };
export type BreakAdjustment = { profile_id: string; work_date: string; break_minutes: number };
export const workDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function rateOnDate(employee: LaborEmployee | undefined, date: string, history: RateChange[]): number | null {
  if (!employee) return null;
  const changes = history.filter(r => r.employee_id === employee.id).sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  const effective = changes.filter(r => r.effective_date <= date).at(-1);
  const value = effective ? effective.new_rate : changes.length ? changes[0].previous_rate : employee.hourly_rate;
  // No history before an initial baseline is unknown, not today's wage.
  const rate = value == null ? null : Number(value);
  return rate != null && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * ledgerThrough: project id -> last work date (YYYY-MM-DD) whose wages are already
 * booked as In-House Labor rows from Nicole's ledger. Clocked time on or before that
 * date keeps its hours and wages but adds no project cost, same as a ledger job.
 */
export function calculateLabor<T extends ClockRow>(logs: T[], employees: LaborEmployee[], history: RateChange[], adjustments: BreakAdjustment[], ledgerProjects: Set<string>, now = Date.now(), ledgerThrough: ReadonlyMap<string, string> = new Map()) {
  const emps = new Map(employees.filter(e => e.profile_id).map(e => [e.profile_id, e]));
  const overrides = new Map(adjustments.map(a => [`${a.profile_id}|${a.work_date}`, a.break_minutes]));
  const rows = logs.filter(l => l.kind !== 'post' && Number.isFinite(Date.parse(l.started_at))).map(log => {
    const open = !log.ended_at;
    const ms = open ? Math.min(12 * 3600000, now - Date.parse(log.started_at)) : Date.parse(log.ended_at!) - Date.parse(log.started_at);
    const rawMinutes = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : 0;
    const date = workDate(log.started_at);
    const rate = rateOnDate(emps.get(log.author_id), date, history);
    return { ...log, date, open, rawMinutes, breakMinutes: 0, paidMinutes: rawMinutes, rate, wageCents: 0, projectCostCents: 0 };
  });
  const days = new Map<string, typeof rows>();
  for (const row of rows.filter(r => !r.open && r.rawMinutes > 0)) {
    const key = `${row.author_id}|${row.date}`;
    days.set(key, [...(days.get(key) ?? []), row]);
  }
  for (const [key, day] of days) {
    const total = day.reduce((s, r) => s + r.rawMinutes, 0);
    const deduction = Math.min(total, Math.max(0, Math.round(overrides.get(key) ?? 30)));
    // Allocate one daily break across ALL jobs, conserving whole minutes.
    const shares = day.map(r => ({ r, exact: deduction * r.rawMinutes / total }));
    for (const s of shares) s.r.breakMinutes = Math.floor(s.exact);
    let remainder = deduction - shares.reduce((s, a) => s + a.r.breakMinutes, 0);
    shares.sort((a, b) => (b.exact % 1) - (a.exact % 1) || a.r.id.localeCompare(b.r.id));
    for (const s of shares) if (remainder-- > 0) s.r.breakMinutes++;
  }
  for (const row of rows) {
    row.paidMinutes -= row.breakMinutes;
    row.wageCents = Math.round(row.paidMinutes / 60 * (row.rate ?? 0) * 100);
    const through = row.project_id ? ledgerThrough.get(row.project_id) : undefined;
    const ledgerCovered = !!row.project_id && (ledgerProjects.has(row.project_id) || (through != null && row.date <= through));
    row.projectCostCents = ledgerCovered ? 0 : row.wageCents;
  }
  return rows;
}
