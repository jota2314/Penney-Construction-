import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeRate, getRateVisibility } from "@/lib/auth/rate-visibility";
import { createClient } from "@/lib/supabase/server";
import { EmployeeList } from "@/components/employees/employee-list";

export const metadata: Metadata = { title: "Employees | Penney Construction" };

export default async function EmployeesPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  const { data: employees } = await supabase
    .from("employees")
    .select("*")
    .order("last_name")
    .order("first_name");

  // Office-team + Howie rates are restricted to owners + precon.
  const vis = await getRateVisibility(user);
  const visible = (employees ?? []).map((e) =>
    canSeeRate(vis, { employeeId: e.id, profileId: e.profile_id })
      ? e
      : { ...e, hourly_rate: null },
  );

  return (
    <>
      <Header title="Employees" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <EmployeeList employees={visible} />
      </div>
    </>
  );
}
