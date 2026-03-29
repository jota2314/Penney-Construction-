import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EmployeeList } from "@/components/employees/employee-list";

export const metadata: Metadata = { title: "Employees | Penney Construction" };

export default async function EmployeesPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: employees } = await supabase
    .from("employees")
    .select("*")
    .order("last_name")
    .order("first_name");

  return (
    <>
      <Header title="Employees" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <EmployeeList employees={employees ?? []} />
      </div>
    </>
  );
}
