import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { EstimateListPage } from "./estimate-list-page";

export const metadata: Metadata = { title: "Estimates | Penney Construction" };

export default async function EstimatesPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: estimates }, { data: walkthroughs }] = await Promise.all([
    supabase
      .from("estimates")
      .select(
        "*, project:projects(name, project_number), lead:leads!estimates_lead_id_fkey(first_name, last_name, lead_number)"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("walkthroughs")
      .select("id, name, address, visited_at, estimate_id, purpose, city")
      .is("estimate_id", null)
      .order("visited_at", { ascending: false }),
  ]);

  return (
    <>
      <Header title="Estimates" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <Suspense>
          <EstimateListPage
            estimates={estimates ?? []}
            availableSiteVisits={(walkthroughs ?? []).map((wt) => ({
              id: wt.id,
              name: wt.name,
              address: wt.address,
              city: wt.city,
              visited_at: wt.visited_at,
              estimate_id: wt.estimate_id,
              purpose: wt.purpose,
              project: null,
            }))}
          />
        </Suspense>
      </div>
    </>
  );
}
