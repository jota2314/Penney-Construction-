import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { getOverheadReport } from "@/lib/finance/overhead";
import { OverheadReportView } from "@/components/finances/overhead-report";


export default async function OverheadPage() {
  const user = await requireAuth();
  // Same line as the rest of the Finances area: owners + precon see dollars.
  if (!canSeeBoardMoney(user.profile?.role)) redirect("/command-center");

  const report = await getOverheadReport(Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric" }).format(new Date())));

  return (
    <>
      <div className="flex flex-col gap-4">
        <OverheadReportView report={report} />
      </div>
    </>
  );
}
