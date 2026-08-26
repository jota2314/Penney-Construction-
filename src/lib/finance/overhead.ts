import { createClient } from "@/lib/supabase/server";

/**
 * What overhead actually costs, month by month — the number the bid markup
 * has to recover.
 *
 * Three rules make this different from "spend on the Overhead project":
 *
 * 1. PAYROLL IS SPLIT. ADP debits are one bulk bank line per run covering the
 *    whole company, so booking them all to Overhead counts the field crew's
 *    wages twice — they are already priced into estimate line items as job
 *    cost. The office/field split lives in `payroll_month_splits`, sourced
 *    from the ADP reports and summing back to the month's ADP cash exactly.
 * 2. CAPEX IS NOT OVERHEAD. Buying a van converts cash into an asset; it is
 *    money out but not a recurring cost, so `is_capex` rows are reported
 *    separately and excluded from the rate. Their running costs (leases,
 *    fuel, repairs) stay in.
 * 3. INTERNAL LABOR ROWS ARE EXCLUDED. `payment_method='internal'` rows are
 *    job-costing placeholders, not cash — the real money is the ADP debit.
 */

export type OverheadMonth = {
  month: string;
  officePayroll: number;
  payrollFees: number;
  nonPayroll: number;
  total: number;
  capex: number;
  revenue: number;
  pctOfRevenue: number | null;
};

export type OverheadCategory = { label: string; total: number };

export type OverheadReport = {
  months: OverheadMonth[];
  categories: OverheadCategory[];
  totalOverhead: number;
  totalCapex: number;
  totalRevenue: number;
  pctOfRevenue: number | null;
  monthlyAverage: number;
  /** Latest complete month — the closest thing to a current run rate. */
  runRate: number | null;
  /** Months with an ADP split on file; anything later is payroll-blind. */
  payrollThrough: string | null;
};

const monthKey = (d: string) => d.slice(0, 7);

export async function getOverheadReport(year = 2026): Promise<OverheadReport> {
  const supabase = await createClient();
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;

  const [{ data: splits }, { data: overheadProjects }, { data: bank }] = await Promise.all([
    supabase
      .from("payroll_month_splits")
      .select("month, office_burdened, fees")
      .gte("month", from)
      .lt("month", to)
      .order("month"),
    supabase.from("projects").select("id").eq("is_overhead", true),
    supabase
      .from("bank_transactions")
      .select("txn_date, amount, direction")
      .gte("txn_date", from)
      .lt("txn_date", to)
      .eq("direction", "credit"),
  ]);

  const overheadIds = (overheadProjects ?? []).map((p) => p.id);

  // Non-payroll overhead: everything booked to an overhead project except the
  // ADP rows (payroll comes from the split), internal labor placeholders, and
  // capital purchases.
  const { data: rows } = overheadIds.length
    ? await supabase
        .from("invoices")
        .select("invoice_date, amount, vendor_name, is_capex, payment_method, estimate_line_items(description)")
        .in("project_id", overheadIds)
        .gte("invoice_date", from)
        .lt("invoice_date", to)
        .limit(2000)
    : { data: [] as never[] };

  const byMonth = new Map<string, OverheadMonth>();
  const ensure = (m: string): OverheadMonth => {
    let entry = byMonth.get(m);
    if (!entry) {
      entry = {
        month: m,
        officePayroll: 0,
        payrollFees: 0,
        nonPayroll: 0,
        total: 0,
        capex: 0,
        revenue: 0,
        pctOfRevenue: null,
      };
      byMonth.set(m, entry);
    }
    return entry;
  };

  for (const s of splits ?? []) {
    const entry = ensure(monthKey(s.month as string));
    entry.officePayroll = Number(s.office_burdened) || 0;
    entry.payrollFees = Number(s.fees) || 0;
  }

  const categoryTotals = new Map<string, number>();
  for (const r of rows ?? []) {
    const amount = Number(r.amount) || 0;
    if (!r.invoice_date) continue;
    const entry = ensure(monthKey(r.invoice_date as string));

    if (r.is_capex) {
      entry.capex += amount;
      continue;
    }
    // ADP cash is already represented by the split; internal rows aren't cash.
    const vendor = r.vendor_name ?? "";
    const isAdp = /^adp/i.test(vendor) && !/adpro/i.test(vendor);
    if (isAdp || r.payment_method === "internal") continue;

    const line = Array.isArray(r.estimate_line_items)
      ? r.estimate_line_items[0]
      : r.estimate_line_items;
    const label = (line as { description?: string } | null)?.description ?? "Uncategorized";

    // Pay that didn't run through ADP still belongs with office payroll, not
    // with rent and fuel — e.g. the checks written for precon work before
    // that person moved onto ADP payroll.
    if (/payroll/i.test(label)) entry.officePayroll += amount;
    else entry.nonPayroll += amount;

    categoryTotals.set(label, (categoryTotals.get(label) ?? 0) + amount);
  }

  for (const b of bank ?? []) {
    const entry = ensure(monthKey(b.txn_date as string));
    entry.revenue += Number(b.amount) || 0;
  }

  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const m of months) {
    m.total = m.officePayroll + m.payrollFees + m.nonPayroll;
    m.pctOfRevenue = m.revenue > 0 ? (m.total / m.revenue) * 100 : null;
  }

  const totalOverhead = months.reduce((s, m) => s + m.total, 0);
  const totalCapex = months.reduce((s, m) => s + m.capex, 0);
  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0);

  // Only months that carry a payroll split are complete enough to average.
  const complete = months.filter((m) => m.officePayroll > 0);
  const payrollThrough = complete.length ? complete[complete.length - 1].month : null;

  return {
    months,
    categories: [...categoryTotals.entries()]
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total),
    totalOverhead,
    totalCapex,
    totalRevenue,
    pctOfRevenue: totalRevenue > 0 ? (totalOverhead / totalRevenue) * 100 : null,
    monthlyAverage: complete.length
      ? complete.reduce((s, m) => s + m.total, 0) / complete.length
      : 0,
    runRate: complete.length ? complete[complete.length - 1].total : null,
    payrollThrough,
  };
}
