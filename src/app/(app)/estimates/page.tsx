import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getEstimatingHubData } from "@/lib/actions/estimates";
import { getTradeRates } from "@/lib/actions/trade-rates";
import { getBidPackages } from "@/lib/actions/bids";
import { EstimatingHubPage } from "@/components/estimates/estimating-hub-page";

export const metadata: Metadata = { title: "Estimating Hub | Penney Construction" };

export default async function EstimatesPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: allEstimates }, hubData, tradeRates, bidPackages] = await Promise.all([
    supabase
      .from("estimates")
      .select(
        "*, project:projects(id, name, project_number, status), lead:leads!estimates_lead_id_fkey(first_name, last_name, lead_number)"
      )
      .order("created_at", { ascending: false }),
    getEstimatingHubData(),
    getTradeRates(),
    getBidPackages(),
  ]);

  // Hide estimates whose parent project is finished work (completed) or
  // dead (cancelled). Those rows clutter the current pipeline view — if
  // someone wants to see them we'll add a "Show completed" toggle later.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const estimates = (allEstimates ?? []).filter((e: any) => {
    const projStatus = e.project?.status;
    return !projStatus || (projStatus !== "completed" && projStatus !== "cancelled");
  });

  return (
    <>
      <Header title="Estimating" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <Suspense>
          <EstimatingHubPage
            hubData={hubData}
            estimates={estimates ?? []}
            bidPackages={bidPackages}
            tradeRates={tradeRates}
          />
        </Suspense>
      </div>
    </>
  );
}
