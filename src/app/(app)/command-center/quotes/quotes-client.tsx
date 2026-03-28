"use client";

import { useState } from "react";
import { QuotePipeline } from "@/components/command-center/quote-pipeline";
import type { QuoteRequest, QuoteRequestStatus } from "@/types/database";

interface QuotesPageClientProps {
  quotes: QuoteRequest[];
  statusCounts: Record<string, number>;
}

export function QuotesPageClient({ quotes, statusCounts }: QuotesPageClientProps) {
  const [filter, setFilter] = useState<QuoteRequestStatus | null>(null);

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
