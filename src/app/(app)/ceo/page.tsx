import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canViewCeoDashboard } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { CeoDashboard, type Period, type PeriodView, type ProjectHealth } from "@/components/ceo/ceo-dashboard";
import { fetchTimeEntriesCompat } from "@/lib/crew/time-entries-compat";
import { getOverheadReport } from "@/lib/finance/overhead";
import { SPEND_CATEGORIES, spendCategoryFor } from "@/lib/finance/spend-category";

export const metadata: Metadata = { title: "CEO Dashboard | Penney Construction" };

// ── Date helpers ──
// invoice_date / received_date / txn_date are plain DATEs, so every period
// test below compares "YYYY-MM-DD" strings — no UTC day-shift possible.
const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDay = (s: string): Date => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date): Date => addDays(d, -((d.getDay() + 6) % 7));
const shortDate = (d: Date): string => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

interface Flow {
  day: string;
  amount: number;
}

export default async function CeoPage() {
  const user = await requireAuth();

  // Jorge-only (email allowlist, impersonation-aware for View-as previews).
  if (!canViewCeoDashboard(user.profile?.email ?? user.email)) {
    redirect("/command-center");
  }

  const supabase = await createClient();

  // Load all data across all projects
  const [
    { data: projects },
    invoices,
    payments,
    { data: cardPayoffs },
    { data: timeEntries },
    { data: liveClockIns },
    { data: changeOrders },
    { data: estimates },
    overhead,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, project_number, status, contract_value, estimated_value, phase, labor_cost_source")
      .in("status", ["contracted", "in_progress", "estimating", "proposal_sent", "lead"])
      .order("created_at", { ascending: false }),
    // Paged: `invoices` is past PostgREST's silent 1000-row cap.
    fetchAllRows((from, to) =>
      supabase
        .from("invoices")
        .select("id, project_id, vendor_name, vendor_type, description, amount, paid_amount, payment_status, payment_method, invoice_date, due_date, trade, projects(is_overhead)")
        .order("invoice_date", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("payments_received")
        .select("id, project_id, payment_type, amount, received_date")
        .order("received_date", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    // Capital One / Amex payoffs out of Eastern — the moment card spend
    // actually leaves the bank (same source /spent renders).
    supabase
      .from("bank_transactions")
      .select("id, txn_date, amount")
      .eq("category_key", "card_payoff")
      .eq("direction", "debit"),
    // Completed field shifts (the single clock system = daily_logs)
    fetchTimeEntriesCompat(supabase, { open: false }).then((data) => ({ data })),
    // Currently on the clock right now
    fetchTimeEntriesCompat(supabase, { open: true }).then((data) => ({ data })),
    supabase
      .from("change_orders")
      .select("id, project_id, price_impact, cost_impact, status")
      .eq("status", "approved"),
    supabase
      .from("estimates")
      .select("id, status"),
    getOverheadReport(new Date().getFullYear()),
  ]);

  const allInvoices = invoices || [];
  const allPayments = payments || [];

  // ── Cash basis (Jorge 8/23/26: "the real number is the one in the bank") ──
  // Same rule as /spent so the two screens can never disagree:
  //  - 'capital_one' charges leave the bank at payoff, so the card-payoff
  //    bank lines stand in for them;
  //  - 'internal' In-House Labor placeholders are wages the ADP payroll rows
  //    already pay — counting both double-counted ~$196K of 2026 labor.
  const isOverheadInv = (i: (typeof allInvoices)[number]): boolean => {
    const proj = Array.isArray(i.projects) ? i.projects[0] : i.projects;
    return !i.project_id || Boolean(proj?.is_overhead);
  };
  const cashOut: (Flow & { category: string })[] = [];
  for (const i of allInvoices) {
    if (i.payment_status !== "paid" || !i.invoice_date) continue;
    if (i.payment_method === "capital_one" || i.payment_method === "internal") continue;
    const category = spendCategoryFor({
      vendorName: i.vendor_name,
      vendorType: i.vendor_type,
      trade: i.trade,
      description: i.description,
      isOverhead: isOverheadInv(i),
    }).key;
    cashOut.push({ day: i.invoice_date.slice(0, 10), amount: Number(i.paid_amount || i.amount || 0), category });
  }
  for (const p of cardPayoffs || []) {
    if (!p.txn_date) continue;
    cashOut.push({ day: p.txn_date.slice(0, 10), amount: Number(p.amount || 0), category: "cardpay" });
  }
  const cashIn: Flow[] = allPayments
    .filter((p) => p.received_date)
    .map((p) => ({ day: p.received_date!.slice(0, 10), amount: Number(p.amount || 0) }));

  const sumBetween = (rows: Flow[], from: string | null, to: string): number =>
    Math.round(rows.reduce((s, r) => (r.day <= to && (!from || r.day >= from) ? s + r.amount : s), 0));

  // Compute financials per project (job-cost basis — card charges and
  // ledger labor ARE job cost even though they are not cash-basis spend).
  const projectFinancials = (projects || []).map((p) => {
    const projInvoices = allInvoices.filter((i) => i.project_id === p.id);
    const projPayments = allPayments.filter((pm) => pm.project_id === p.id);
    const projCOs = (changeOrders || []).filter((co) => co.project_id === p.id);
    const projTime = (timeEntries || []).filter((t) => t.project_id === p.id);

    const totalInvoiced = projInvoices.reduce((s, i) => s + Number(i.amount || 0), 0);
    const totalPaid = projInvoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
    const unpaidInvoices = totalInvoiced - totalPaid;
    const totalReceived = projPayments.reduce((s, pm) => s + Number(pm.amount || 0), 0);
    const coRevenue = projCOs.reduce((s, co) => s + Number(co.price_impact || 0), 0);
    const contractValue = Number(p.contract_value || p.estimated_value || 0);
    const adjustedContract = contractValue + coRevenue;
    const outstanding = adjustedContract - totalReceived;

    // Ledger-costed jobs carry their labor as payroll invoice rows, so their
    // clocked dollars are zeroed — same rule as getProjectLaborCost().
    const laborCost =
      p.labor_cost_source === "ledger" ? 0 : projTime.reduce((s, t) => s + t.project_cost_cents / 100, 0);

    return {
      ...p,
      totalInvoiced,
      totalPaid,
      unpaidInvoices,
      totalReceived,
      outstanding,
      adjustedContract,
      coRevenue,
      coCount: projCOs.length,
      laborCost,
      jobCost: totalInvoiced + laborCost,
      totalSpent: totalPaid + laborCost,
      cashFlow: totalReceived - totalPaid - laborCost,
    };
  });

  // Company-wide totals
  const activeProjects = projectFinancials.filter((p) => p.status === "contracted" || p.status === "in_progress");
  const totals = {
    totalContractValue: activeProjects.reduce((s, p) => s + p.adjustedContract, 0),
    totalReceived: activeProjects.reduce((s, p) => s + p.totalReceived, 0),
    totalOutstanding: activeProjects.reduce((s, p) => s + p.outstanding, 0),
    totalApprovedCOs: activeProjects.reduce((s, p) => s + p.coRevenue, 0),
    projectCount: activeProjects.length,
  };

  // ── Period windows (Eastern time, Monday weeks — matches /week + /spent) ──
  const now = new Date();
  const nowET = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const today = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate());
  const todayStr = isoDay(today);
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const weekStart = mondayOf(today);

  // Same point in the previous period: YTD vs last YTD, month-to-date vs
  // the same days of last month, week-to-date vs the same days last week.
  const lastYearSameDay = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const lastMonthSameDay = new Date(
    lastMonthStart.getFullYear(),
    lastMonthStart.getMonth(),
    Math.min(today.getDate(), lastMonthEnd.getDate()),
  );

  // ── Trend buckets per period ──
  type Bucket = { label: string; from: string; to: string };
  const dayBuckets = (from: Date, to: Date, label: (d: Date) => string): Bucket[] => {
    const out: Bucket[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ label: label(d), from: isoDay(d), to: isoDay(d) });
    return out;
  };
  const weekBuckets = (from: Date, to: Date): Bucket[] => {
    const out: Bucket[] = [];
    for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) {
      // First bucket starts at the period start, so a Jan 1 mid-week doesn't
      // pull last December's days into this year's chart.
      out.push({ label: shortDate(d), from: isoDay(d < from ? from : d), to: isoDay(addDays(d, 6)) });
    }
    return out;
  };
  const monthBuckets = (from: Date, to: Date): Bucket[] => {
    const out: Bucket[] = [];
    for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      out.push({
        label: d.toLocaleDateString("en-US", { month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "2-digit" }),
        from: isoDay(d),
        to: isoDay(end),
      });
    }
    return out;
  };

  // All-time starts at the first real money movement (ignores typo'd years).
  const firstDay = [...cashOut, ...cashIn]
    .map((r) => r.day)
    .filter((d) => d >= "2020-01-01")
    .reduce((min, d) => (d < min ? d : min), todayStr);

  function buildView(opts: {
    from: string | null;
    prev: { from: string; to: string; label: string } | null;
    buckets: Bucket[];
    trendTitle: string;
  }): PeriodView {
    const spent = sumBetween(cashOut, opts.from, todayStr);
    const received = sumBetween(cashIn, opts.from, todayStr);

    const catTotals = new Map<string, number>();
    for (const r of cashOut) {
      if (r.day > todayStr || (opts.from && r.day < opts.from)) continue;
      catTotals.set(r.category, (catTotals.get(r.category) || 0) + r.amount);
    }
    const whereItWent = [...catTotals.entries()]
      .map(([key, amount]) => ({ key, label: SPEND_CATEGORIES[key]?.label ?? key, dot: SPEND_CATEGORIES[key]?.dot ?? "bg-zinc-500", amount: Math.round(amount) }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    return {
      spent,
      received,
      // Only compare against a window the books fully cover — 2025 holds a
      // handful of rows, and "+3,000% vs last year" says nothing.
      prev: opts.prev && opts.prev.from >= firstDay
        ? {
            label: opts.prev.label,
            spent: sumBetween(cashOut, opts.prev.from, opts.prev.to),
            received: sumBetween(cashIn, opts.prev.from, opts.prev.to),
          }
        : null,
      trendTitle: opts.trendTitle,
      trend: opts.buckets.map((b) => ({
        label: b.label,
        spent: sumBetween(cashOut, b.from, b.to),
        received: sumBetween(cashIn, b.from, b.to),
        future: b.from > todayStr,
      })),
      whereItWent,
    };
  }

  const views: Record<Exclude<Period, "daily">, PeriodView> = {
    all: buildView({
      from: null,
      prev: null,
      buckets: monthBuckets(parseDay(firstDay), today),
      trendTitle: "Monthly cash flow — all time",
    }),
    year: buildView({
      from: isoDay(yearStart),
      prev: { from: isoDay(new Date(today.getFullYear() - 1, 0, 1)), to: isoDay(lastYearSameDay), label: `same point in ${today.getFullYear() - 1}` },
      buckets: weekBuckets(yearStart, today),
      trendTitle: `Weekly cash flow — ${today.getFullYear()}`,
    }),
    month: buildView({
      from: isoDay(monthStart),
      prev: { from: isoDay(lastMonthStart), to: isoDay(lastMonthSameDay), label: "same days last month" },
      buckets: dayBuckets(monthStart, today, (d) => String(d.getDate())),
      trendTitle: `Daily cash flow — ${today.toLocaleDateString("en-US", { month: "long" })}`,
    }),
    week: buildView({
      from: isoDay(weekStart),
      prev: { from: isoDay(addDays(weekStart, -7)), to: isoDay(addDays(today, -7)), label: "same days last week" },
      buckets: dayBuckets(weekStart, addDays(weekStart, 6), (d) => d.toLocaleDateString("en-US", { weekday: "short" })),
      trendTitle: `This week — ${shortDate(weekStart)} to ${shortDate(addDays(weekStart, 6))}`,
    }),
  };

  // ── Today (LIVE) ──
  // Money that moved today plus crew labor on the clock right now.
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayInvoiceSpend = sumBetween(cashOut, todayStr, todayStr);
  const todayPaymentsReceived = sumBetween(cashIn, todayStr, todayStr);
  const todayCompletedLabor = (timeEntries || [])
    .filter((t) => new Date(t.clock_in) >= todayStart)
    .reduce((s, t) => s + t.project_cost_cents / 100, 0);
  const liveLabor = (liveClockIns || []).reduce((s, t) => s + t.project_cost_cents / 100, 0);
  const todayTotalLabor = todayCompletedLabor + liveLabor;

  const clockedInEmployees = (liveClockIns || []).map((t) => {
    const emp = Array.isArray(t.employees) ? t.employees[0] : t.employees;
    return emp ? `${emp.first_name} ${emp.last_name}` : "Unknown";
  });

  const last14 = dayBuckets(addDays(today, -13), today, (d) => shortDate(d));
  const dailyBase = buildView({
    from: todayStr,
    prev: null,
    buckets: last14,
    trendTitle: "Daily cash flow — last 14 days",
  });
  const allViews: Record<Period, PeriodView> = {
    ...views,
    daily: { ...dailyBase, spent: Math.round(todayInvoiceSpend + todayTotalLabor) },
  };

  const liveDaily = {
    laborCost: Math.round(todayTotalLabor),
    invoiceSpend: Math.round(todayInvoiceSpend),
    received: Math.round(todayPaymentsReceived),
    clockedIn: clockedInEmployees.length,
    clockedInNames: clockedInEmployees,
  };

  // 30-day daily rates (cash basis)
  const thirtyAgo = isoDay(addDays(today, -29));
  const dailySpendRate = sumBetween(cashOut, thirtyAgo, todayStr) / 30;
  const dailyEarnRate = sumBetween(cashIn, thirtyAgo, todayStr) / 30;

  // ── Estimates ──
  const allEstimates = estimates || [];
  const estimatesSent = allEstimates.filter((e) => e.status === "sent" || e.status === "approved" || e.status === "rejected").length;
  const estimatesWon = allEstimates.filter((e) => e.status === "approved").length;
  const estimatesTotal = allEstimates.length;

  // Unpaid bills. Totals are computed over ALL unpaid rows BEFORE the display
  // slice — the list itself is capped at 50.
  const allUnpaid = allInvoices
    .filter((i) => i.payment_status !== "paid" && Number(i.amount) > 0)
    .sort((a, b) => (a.due_date || a.invoice_date || "").localeCompare(b.due_date || b.invoice_date || ""));
  const unpaidCount = allUnpaid.length;
  const unpaidTotal = Math.round(allUnpaid.reduce((s, i) => s + (Number(i.amount) - Number(i.paid_amount || 0)), 0));
  const projectNameById = new Map((projects || []).map((p) => [p.id, p.name]));
  const unpaidInvoices = allUnpaid.slice(0, 50).map((i) => {
    const due = i.due_date || i.invoice_date;
    return {
      id: i.id,
      vendor_name: i.vendor_name,
      amount: Math.round(Number(i.amount) - Number(i.paid_amount || 0)),
      due_date: due,
      daysOld: due ? Math.floor((today.getTime() - parseDay(due).getTime()) / 86_400_000) : null,
      project_name: (i.project_id && projectNameById.get(i.project_id)) || "No project",
    };
  });

  // Labor hours last 30 days
  const thirtyDaysAgo = addDays(today, -30);
  const recentTime = (timeEntries || []).filter((t) => new Date(t.clock_in) >= thirtyDaysAgo);
  const recentHours = recentTime.reduce((s, t) => s + t.paid_minutes / 60, 0);
  const recentLaborCost = recentTime.reduce((s, t) => s + t.project_cost_cents / 100, 0);

  // ── Project health ──
  const projectHealth: ProjectHealth[] = activeProjects
    .filter((p) => p.adjustedContract > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      projectNumber: p.project_number,
      contract: Math.round(p.adjustedContract),
      received: Math.round(p.totalReceived),
      jobCost: Math.round(p.jobCost),
      leftToCollect: Math.round(p.outstanding),
      coRevenue: Math.round(p.coRevenue),
      coCount: p.coCount,
      unpaidBills: Math.round(p.unpaidInvoices),
    }));

  return (
    <>
      <Header title="CEO Dashboard" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <CeoDashboard
          totals={totals}
          views={allViews}
          liveDaily={liveDaily}
          estimatesSent={estimatesSent}
          estimatesWon={estimatesWon}
          estimatesTotal={estimatesTotal}
          projectHealth={projectHealth}
          unpaidInvoices={unpaidInvoices}
          unpaidCount={unpaidCount}
          unpaidTotal={unpaidTotal}
          dailySpendRate={Math.round(dailySpendRate)}
          dailyEarnRate={Math.round(dailyEarnRate)}
          laborHours30d={Math.round(recentHours)}
          laborCost30d={Math.round(recentLaborCost)}
          overhead={{
            total: Math.round(overhead.totalOverhead),
            pctOfRevenue: overhead.pctOfRevenue,
            runRate: overhead.runRate === null ? null : Math.round(overhead.runRate),
            payrollThrough: overhead.payrollThrough,
          }}
        />
      </div>
    </>
  );
}
