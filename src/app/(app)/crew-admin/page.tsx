import { requireAuth } from "@/lib/auth/require-auth";
import { getCrewAdminData } from "@/lib/actions/crew-admin";
import { CrewAdminTabs } from "@/components/crew-admin/crew-admin-tabs";
import { Header } from "@/components/layout/header";
import { canViewPayroll } from "@/lib/auth/role-access";

export default async function CrewAdminPage() {
  const user = await requireAuth();
  const data = await getCrewAdminData();

  // Payroll (pay rates + editable hours) — owner, office admin, precon manager.
  // Same set may edit rates; setEmployeeHourlyRate re-checks server-side and
  // additionally blocks office-team rates for viewers who can't see them.
  const showPayroll = canViewPayroll(user.profile?.role);

  return (
    <>
      <Header title="Crew Management" backHref="/command-center" />
      <div className="p-4 md:p-6">
        <CrewAdminTabs
          data={data}
          canViewPayroll={showPayroll}
          canEditRates={showPayroll}
        />
      </div>
    </>
  );
}
