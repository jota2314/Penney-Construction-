import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { FinanceTabs } from "@/components/finances/finance-tabs";
import { FinancialDailyLog } from "@/components/finances/financial-daily-log";
import { DailyLogPanel } from "@/components/finances/daily-log-panel";
import { DailyLogWorkspace, WORKSPACE_TITLES } from "@/components/finances/daily-log-workspace";
import { Suspense } from "react";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { buildDailyLog, validMonth, type DailyExpense, type DailyIncome } from "@/lib/finance/daily-log";

export const metadata: Metadata = { title: "Financial Daily Log | Penney Construction" };

export default async function DailyLogPage({ searchParams }: { searchParams: Promise<{ month?: string; panel?: string; id?: string }> }) {
  const user = await requireAuth();
  if (!canSeeBoardMoney(user.profile?.role)) redirect("/command-center");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const params = await searchParams;
  const month = validMonth(params.month, today);
  const panel = params.panel && Object.hasOwn(WORKSPACE_TITLES, params.panel) ? params.panel : null;
  const db = await createClient();
  // Fetch complete groups before filtering dates, including undated records.
  // Reads use the signed-in user's RLS, never the service-role client.
  async function expenses() {
    const rows: DailyExpense[] = [];
    for (let start = 0; ; start += 500) {
      const { data, error } = await db.from("invoices")
        .select("id, project_id, vendor_name, amount, description, source, review_status, invoice_number, invoice_date, split_group_id, payment_status, payment_method, duplicate_of_id, projects(name, project_number)")
        .is("duplicate_of_id", null).order("id").range(start, start + 499);
      if (error) throw new Error("Expenses could not be loaded");
      rows.push(...data as DailyExpense[]);
      if (data.length < 500) return rows;
    }
  }
  async function income() {
    const rows: DailyIncome[] = [];
    for (let start = 0; ; start += 500) {
      const { data, error } = await db.from("payments_received")
        .select("id, project_id, amount, description, source, review_status, payer_name, received_date, reference_number, method, projects(name, project_number)")
        .order("id").range(start, start + 499);
      if (error) throw new Error("Income could not be loaded");
      rows.push(...data as DailyIncome[]);
      if (data.length < 500) return rows;
    }
  }
  let records: ReturnType<typeof buildDailyLog> = [];
  let failed = false;
  try {
    const [bills, payments] = await Promise.all([expenses(), income()]);
    records = buildDailyLog(bills, payments);
  } catch {
    failed = true;
  }
  return <>
    <Header title="Finances" backHref="/command-center" />
    <div className="flex flex-col gap-5 p-4 pb-24 sm:p-6">
      <FinanceTabs current="daily" />
      <FinancialDailyLog records={records.filter(r => !r.date || r.date.startsWith(month))} month={month} today={today} failed={failed} />
      {panel && <DailyLogPanel title={WORKSPACE_TITLES[panel]} month={month}>
        <Suspense key={`${panel}:${params.id ?? ""}`} fallback={<p role="status">Loading workspace…</p>}>
          <DailyLogWorkspace panel={panel} id={params.id} month={month} records={records} failed={failed} />
        </Suspense>
      </DailyLogPanel>}
    </div>
  </>;
}
