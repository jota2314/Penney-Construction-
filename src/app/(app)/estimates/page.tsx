import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EstimateListPage } from "./estimate-list-page";

export default async function EstimatesPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: estimates }, { data: siteVisits }] = await Promise.all([
    supabase
      .from("estimates")
      .select(
        "*, project:projects(name, project_number), lead:leads(first_name, last_name, lead_number)"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("site_visits")
      .select("id, name, address, visited_at, visit_type, estimate_id, purpose, city, project:projects(name, address, city)")
      .is("estimate_id", null)
      .eq("visit_type", "pricing")
      .order("visited_at", { ascending: false }),
  ]);

  return (
    <>
      <Header title="Estimates" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <Suspense>
          <EstimateListPage
            estimates={estimates ?? []}
            availableSiteVisits={siteVisits ?? []}
          />
        </Suspense>
      </div>
    </>
  );
}
