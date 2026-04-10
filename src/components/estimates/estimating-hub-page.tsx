"use client";

import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HubDashboard } from "./hub-dashboard";
import { EstimateList } from "./estimate-list";
import { BidDashboard } from "@/components/bids/bid-dashboard";
import { TradeRateList } from "@/components/trade-rates/trade-rate-list";
import type { EstimatingHubData } from "@/lib/actions/estimates";
import type { TradeRate } from "@/types/database";

interface EstimatingHubPageProps {
  hubData: EstimatingHubData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  estimates: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bidPackages: any[];
  tradeRates: TradeRate[];
}

export function EstimatingHubPage({ hubData, estimates, bidPackages, tradeRates }: EstimatingHubPageProps) {
  const [tab, setTab] = useSearchParamState("tab", "dashboard");

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
          <TabsTrigger value="dashboard" className="text-xs sm:text-sm">Dashboard</TabsTrigger>
          <TabsTrigger value="estimates" className="text-xs sm:text-sm">
            Estimates
            <span className="ml-1.5 text-[10px] text-muted-foreground">{estimates.length}</span>
          </TabsTrigger>
          <TabsTrigger value="bids" className="text-xs sm:text-sm">
            Bids
            {hubData.bidStats.active > 0 && (
              <span className="ml-1.5 text-[10px] text-amber-400">{hubData.bidStats.active}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="costbook" className="text-xs sm:text-sm">
            Cost Book
            <span className="ml-1.5 text-[10px] text-muted-foreground">{tradeRates.length}</span>
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="dashboard" className="mt-4">
        <HubDashboard data={hubData} />
      </TabsContent>

      <TabsContent value="estimates" className="mt-4">
        <EstimateList estimates={estimates} />
      </TabsContent>

      <TabsContent value="bids" className="mt-4">
        <BidDashboard packages={bidPackages} />
      </TabsContent>

      <TabsContent value="costbook" className="mt-4">
        <TradeRateList rates={tradeRates} />
      </TabsContent>
    </Tabs>
  );
}
