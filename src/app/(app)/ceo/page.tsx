import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { CeoDashboard } from "@/components/ceo/ceo-dashboard";

export const metadata: Metadata = { title: "CEO Dashboard | Penney Construction" };

export default async function CeoPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  // Restrict to owner + precon roles
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "owner" && profile?.role !== "precon_manager") {
    redirect("/command-center");
  }

  // Load all data across all projects
  const [
    { data: projects },
    { data: invoices },
    { data: payments },
    { data: timeEntries },
    { data: changeOrders },
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, project_number, status, contract_value, estimated_value, phase")
      .in("status", ["contracted", "in_progress", "estimating", "proposal_sent", "lead"])
      .order("created_at", { ascending: false }),
    supabase
      .from("invoices")
      .select("id, project_id, vendor_name, amount, paid_amount, payment_status, invoice_date, due_date, trade")
      .order("invoice_date", { ascending: false }),
    supabase
      .from("payments_received")
      .select("id, project_id, payment_type, amount, received_date")
      .order("received_date", { ascending: false }),
    supabase
      .from("time_entries")
      .select("id, project_id, clock_in, clock_out, break_minutes, employees(hourly_rate)")
      .not("clock_out", "is", null),
    supabase
      .from("change_orders")
      .select("id, project_id, price_impact, cost_impact, status")
      .eq("status", "approved"),
  ]);

  // Compute financials per project
  const projectFinancials = (projects || []).map((p) => {
    const projInvoices = (invoices || []).filter((i) => i.project_id === p.id);
    const projPayments = (payments || []).filter((pm) => pm.project_id === p.id);
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

    // Labor cost
    const laborCost = projTime.reduce((s, t) => {
      const emp = Array.isArray(t.employees) ? t.employees[0] : t.employees;
      const rate = Number(emp?.hourly_rate || 0);
      const ms = new Date(t.clock_out!).getTime() - new Date(t.clock_in).getTime();
      const hours = Math.max(0, ms / 3600000 - (t.break_minutes || 0) / 60);
      return s + hours * rate;
    }, 0);

    return {
      ...p,
      totalInvoiced,
      totalPaid,
      unpaidInvoices,
      totalReceived,
      outstanding,
      adjustedContract,
      laborCost,
      totalSpent: totalPaid + laborCost,
      cashFlow: totalReceived - totalPaid - laborCost,
    };
  });

  // Company-wide totals
  const activeProjects = projectFinancials.filter((p) => p.status === "contracted" || p.status === "in_progress");
  const totals = {
    totalContractValue: activeProjects.reduce((s, p) => s + p.adjustedContract, 0),
    totalInvoiced: activeProjects.reduce((s, p) => s + p.totalInvoiced, 0),
    totalPaid: activeProjects.reduce((s, p) => s + p.totalPaid, 0),
    totalReceived: activeProjects.reduce((s, p) => s + p.totalReceived, 0),
    totalOutstanding: activeProjects.reduce((s, p) => s + p.outstanding, 0),
    totalUnpaidInvoices: activeProjects.reduce((s, p) => s + p.unpaidInvoices, 0),
    totalLaborCost: activeProjects.reduce((s, p) => s + p.laborCost, 0),
    totalSpent: activeProjects.reduce((s, p) => s + p.totalSpent, 0),
    cashPosition: activeProjects.reduce((s, p) => s + p.cashFlow, 0),
    projectCount: activeProjects.length,
  };

  // Upcoming: unpaid invoices due soon
  const unpaidInvoices = (invoices || [])
    .filter((i) => i.payment_status !== "paid" && Number(i.amount) > 0)
    .sort((a, b) => (a.due_date || a.invoice_date || "").localeCompare(b.due_date || b.invoice_date || ""))
    .slice(0, 15);

  // Daily spend rate (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentInvoices = (invoices || []).filter(
    (i) => i.payment_status === "paid" && i.invoice_date && new Date(i.invoice_date) >= thirtyDaysAgo
  );
  const recentSpend = recentInvoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const dailySpendRate = recentSpend / 30;

  // Daily earn rate (last 30 days)
  const recentPayments = (payments || []).filter(
    (p) => p.received_date && new Date(p.received_date) >= thirtyDaysAgo
  );
  const recentEarned = recentPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const dailyEarnRate = recentEarned / 30;

  // Labor hours last 30 days
  const recentTime = (timeEntries || []).filter(
    (t) => new Date(t.clock_in) >= thirtyDaysAgo
  );
  const recentHours = recentTime.reduce((s, t) => {
    const ms = new Date(t.clock_out!).getTime() - new Date(t.clock_in).getTime();
    return s + Math.max(0, ms / 3600000 - (t.break_minutes || 0) / 60);
  }, 0);
  const recentLaborCost = recentTime.reduce((s, t) => {
    const emp = Array.isArray(t.employees) ? t.employees[0] : t.employees;
    const rate = Number(emp?.hourly_rate || 0);
    const ms = new Date(t.clock_out!).getTime() - new Date(t.clock_in).getTime();
    const hours = Math.max(0, ms / 3600000 - (t.break_minutes || 0) / 60);
    return s + hours * rate;
  }, 0);

  return (
    <>
      <Header title="CEO Dashboard" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <CeoDashboard
          totals={totals}
          projects={activeProjects}
          unpaidInvoices={unpaidInvoices.map((i) => ({
            id: i.id,
            vendor_name: i.vendor_name,
            amount: Number(i.amount),
            due_date: i.due_date || i.invoice_date,
            trade: i.trade,
            project_name: activeProjects.find((p) => p.id === i.project_id)?.name || "Unknown",
          }))}
          dailySpendRate={Math.round(dailySpendRate)}
          dailyEarnRate={Math.round(dailyEarnRate)}
          laborHours30d={Math.round(recentHours)}
          laborCost30d={Math.round(recentLaborCost)}
        />
      </div>
    </>
  );
}
