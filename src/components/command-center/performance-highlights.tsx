interface PerformanceData {
  emailsSent: number;
  emailBreakdown: Record<string, number>;
  clientCoverage: { sent: number; total: number };
  activeQuotes: number;
}

interface PerformanceHighlightsProps {
  data: PerformanceData;
}

const CATEGORY_LABELS: Record<string, string> = {
  client_update: "client updates",
  sub_outreach: "sub outreach",
  internal: "internal",
  quote: "quotes",
  follow_up: "follow-ups",
  other: "other",
};

export function PerformanceHighlights({ data }: PerformanceHighlightsProps) {
  const breakdownStr = Object.entries(data.emailBreakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([cat, count]) => {
      const pct =
        data.emailsSent > 0
          ? Math.round((count / data.emailsSent) * 100)
          : 0;
      return `${pct}% ${CATEGORY_LABELS[cat] || cat}`;
    })
    .join(", ");

  const highlights = [
    {
      value: `${data.emailsSent} emails sent`,
      detail: breakdownStr || "No emails this week",
      color: "text-yellow-400",
    },
    {
      value:
        data.clientCoverage.total > 0
          ? `${Math.round(
              (data.clientCoverage.sent / data.clientCoverage.total) * 100
            )}% client coverage`
          : "No clients tracked",
      detail:
        data.clientCoverage.total > 0
          ? `${data.clientCoverage.sent} of ${data.clientCoverage.total} clients contacted this week`
          : "Add client updates to track coverage",
      color: "text-emerald-400",
    },
    {
      value: `${data.activeQuotes} quote requests active`,
      detail: "Tracking across all projects",
      color: "text-purple-400",
    },
  ];

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Key Performance Highlights</h3>
      <div className="space-y-4">
        {highlights.map((h, i) => (
          <div key={i} className="flex items-baseline gap-4">
            <span className={`font-semibold ${h.color} whitespace-nowrap`}>
              {h.value}
            </span>
            <span className="text-sm text-muted-foreground">{h.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
