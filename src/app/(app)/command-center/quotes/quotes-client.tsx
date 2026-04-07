"use client";

import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import { QuotePipeline } from "@/components/command-center/quote-pipeline";
import type { QuoteRequest, QuoteRequestStatus } from "@/types/database";

interface QuotesPageClientProps {
  quotes: QuoteRequest[];
  statusCounts: Record<string, number>;
}

export function QuotesPageClient({ quotes, statusCounts }: QuotesPageClientProps) {
  const [filterParam, setFilterParam] = useSearchParamState("filter", "all");
  const filter: QuoteRequestStatus | null = filterParam === "all" ? null : filterParam as QuoteRequestStatus;
  const setFilter = (v: QuoteRequestStatus | null) => setFilterParam(v ?? "all");

  const filtered = filter ? quotes.filter((q) => q.status === filter) : quotes;

  return (
    <QuotePipeline
      quotes={filtered}
      statusCounts={statusCounts}
      activeFilter={filter}
      onFilterChange={setFilter}
    />
  );
}
