import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { LeadsPageContent } from "@/components/leads/leads-page-content";

export const metadata: Metadata = { title: "Leads | Penney Construction" };

export default async function LeadsPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <>
      <Header title="Leads" backHref="/crm" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <Suspense>
          <LeadsPageContent leads={leads ?? []} />
        </Suspense>
      </div>
    </>
  );
}
