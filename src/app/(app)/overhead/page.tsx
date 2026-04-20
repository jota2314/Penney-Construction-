import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { OverheadDashboard } from "@/components/overhead/overhead-dashboard";

export const metadata: Metadata = { title: "Overhead & Bid Markup | Penney Construction" };

export default async function OverheadPage() {
  await requireAuth();
  const supabase = await createClient();

  const [{ data: calcRows }, { data: configRows }] = await Promise.all([
    supabase.from("overhead_calc").select("*").order("period_start", { ascending: false }),
    supabase.from("overhead_config").select("*").order("period_start", { ascending: false }),
  ]);

  const latestCalc = calcRows?.[0] ?? null;
  const latestConfig = configRows?.[0] ?? null;
  const history = calcRows ?? [];

  return (
    <>
      <Header title="Overhead & Bid Markup" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        <OverheadDashboard
          latestCalc={latestCalc}
          latestConfig={latestConfig}
          history={history}
        />
      </div>
    </>
  );
}
