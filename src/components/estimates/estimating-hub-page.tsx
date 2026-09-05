"use client";

import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HubDashboard } from "./hub-dashboard";
import { EstimateList } from "./estimate-list";
import { BidDashboard } from "@/components/bids/bid-dashboard";
import { TradeRateList } from "@/components/trade-rates/trade-rate-list";
import type { EstimatingHubData } from "@/lib/actions/estimates";
import type { TradeRate } from "@/types/database";
import type { EstimatingWorkbenchData } from "@/lib/actions/estimating-workbench";
import { EstimatingWorkbench, QuoteEvidence, LaborEvidence } from "./estimating-workbench";

interface EstimatingHubPageProps {
  hubData: EstimatingHubData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  estimates: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bidPackages: any[];
  tradeRates: TradeRate[];
  workbench: EstimatingWorkbenchData;
}

export function EstimatingHubPage({ hubData, estimates, bidPackages, tradeRates, workbench }: EstimatingHubPageProps) {
  const [tab, setTab] = useSearchParamState("tab", "home");

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
          <TabsTrigger value="home" className="text-xs sm:text-sm">My estimating</TabsTrigger>
          <TabsTrigger value="prices" className="text-xs sm:text-sm">Prices received</TabsTrigger>
          <TabsTrigger value="labor" className="text-xs sm:text-sm">Field learning</TabsTrigger>
          <TabsTrigger value="dashboard" className="text-xs sm:text-sm">Financials</TabsTrigger>
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

      <TabsContent value="home" className="mt-4">
        <EstimatingWorkbench data={workbench} estimates={estimates} />
      </TabsContent>
      <TabsContent value="prices" className="mt-4"><QuoteEvidence quotes={workbench.quotes} /></TabsContent>
      <TabsContent value="labor" className="mt-4"><LaborEvidence logs={workbench.labor} /></TabsContent>
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
