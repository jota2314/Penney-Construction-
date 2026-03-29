import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { CustomerList } from "@/components/customers/customer-list";

export const metadata: Metadata = { title: "Customers | Penney Construction" };

export default async function CustomersPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: customers } = await supabase
    .from("customers")
    .select("*")
    .order("last_name")
    .order("first_name");

  return (
    <>
      <Header title="Customers" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <CustomerList customers={customers ?? []} />
      </div>
    </>
  );
}
