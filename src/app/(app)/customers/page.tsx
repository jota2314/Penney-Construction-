import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { CustomerList } from "@/components/customers/customer-list";

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
      <Header title="Customers" />
      <div className="flex flex-1 flex-col gap-6 p-6">
        <CustomerList customers={customers ?? []} />
      </div>
    </>
  );
}
