"use client";

import { Badge } from "@/components/ui/badge";
import type { QuoteRequest, QuoteRequestStatus } from "@/types/database";

const STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  just_sent: "JUST SENT",
  awaiting_reply: "AWAITING",
  received: "RECEIVED",
  in_progress: "IN PROGRESS",
  accepted: "ACCEPTED",
  declined: "DECLINED",
};

const STATUS_COLORS: Record<QuoteRequestStatus, string> = {
  just_sent: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  awaiting_reply: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  received: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  in_progress: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  accepted: "bg-green-500/20 text-green-400 border-green-500/30",
  declined: "bg-red-500/20 text-red-400 border-red-500/30",
};

interface QuotePipelineProps {
  quotes: QuoteRequest[];
  statusCounts: Record<string, number>;
  activeFilter: QuoteRequestStatus | null;
  onFilterChange: (status: QuoteRequestStatus | null) => void;
}

export function QuotePipeline({
  quotes,
  statusCounts,
  activeFilter,
  onFilterChange,
}: QuotePipelineProps) {
  const total =
    (statusCounts.received || 0) +
    (statusCounts.in_progress || 0) +
    (statusCounts.awaiting_reply || 0) +
    (statusCounts.just_sent || 0);

  const filters: { label: string; status: QuoteRequestStatus | null; count: number }[] = [
    { label: "All", status: null, count: total },
    { label: "Received", status: "received", count: statusCounts.received || 0 },
    { label: "In Progress", status: "in_progress", count: statusCounts.in_progress || 0 },
    { label: "Awaiting", status: "awaiting_reply", count: statusCounts.awaiting_reply || 0 },
    { label: "Just Sent", status: "just_sent", count: statusCounts.just_sent || 0 },
  ];

  return (
    <div>
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {filters.map((f) => (
          <button
            key={f.label}
            onClick={() => onFilterChange(f.status)}
            className={`rounded-full px-3 py-1 text-sm font-medium border transition-colors ${
              activeFilter === f.status
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      <h3 className="text-lg font-semibold mb-3">Quote Pipeline</h3>

      {quotes.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No quotes tracked yet. Add quotes as you send them to subs.
        </div>
      ) : (
        <div className="space-y-2">
          {quotes.map((quote) => {
            const dateStr = new Date(quote.sent_at).toLocaleDateString(
              "en-US",
              { month: "numeric", day: "numeric" }
            );

            return (
              <div
                key={quote.id}
                className="rounded-lg border bg-card p-4 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{quote.subcontractor_name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant="outline"
                      className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border-amber-500/30"
                    >
                      {quote.project_name.toUpperCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {dateStr}
                    </span>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] font-bold ${
                    STATUS_COLORS[quote.status]
                  }`}
                >
                  {STATUS_LABELS[quote.status]}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
