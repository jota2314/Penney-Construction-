import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { getTradeRates } from "@/lib/actions/trade-rates";
import { TradeRateList } from "@/components/trade-rates/trade-rate-list";

export const metadata: Metadata = { title: "Cost Book | Penney Construction" };

export default async function CostBookPage() {
  await requireAuth();
  const rates = await getTradeRates();

  return (
    <>
      <Header title="Cost Book" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        <TradeRateList rates={rates} />
      </div>
    </>
  );
}
