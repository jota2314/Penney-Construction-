import { getAiCostSummary } from "@/lib/actions/ai-costs";
import { Brain } from "lucide-react";

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function AiCostBanner() {
  let costs;
  try {
    costs = await getAiCostSummary();
  } catch {
    return null; // Table might not exist yet
  }

  // Don't show if no data yet
  if (costs.allTimeCents === 0 && costs.monthCalls === 0) return null;

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-500" />
          <span className="text-xs font-medium text-purple-400">AI Spend</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="text-right">
            <span className="text-muted-foreground">Today </span>
            <span className="font-mono font-medium">
              {formatCost(costs.todayCents)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-muted-foreground">This Week </span>
            <span className="font-mono font-medium">
              {formatCost(costs.weekCents)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-muted-foreground">Month </span>
            <span className="font-mono font-semibold text-purple-400">
              {formatCost(costs.monthCents)}
            </span>
          </div>
        </div>
      </div>
      {costs.monthCalls > 0 && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-muted-foreground">
            {costs.monthCalls} API calls this month
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            All time: {formatCost(costs.allTimeCents)}
          </span>
        </div>
      )}
    </div>
  );
}
