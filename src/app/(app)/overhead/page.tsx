import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { FinanceTabs } from "@/components/finances/finance-tabs";
import { getOverheadReport } from "@/lib/finance/overhead";
import { OverheadReportView } from "@/components/finances/overhead-report";

export const metadata: Metadata = { title: "Overhead | Penney Construction" };

export default async function OverheadPage() {
  const user = await requireAuth();
  // Same line as the rest of the Finances area: owners + precon see dollars.
  if (!canSeeBoardMoney(user.profile?.role)) redirect("/command-center");

  const report = await getOverheadReport(2026);

  return (
    <>
      <Header title="Finances" backHref="/command-center" />
      <div className="flex flex-col gap-4 p-4 sm:p-6 pb-24 sm:pb-8">
        <FinanceTabs current="overhead" />
        <OverheadReportView report={report} />
      </div>
    </>
  );
}
