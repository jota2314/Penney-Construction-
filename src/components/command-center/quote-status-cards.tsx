interface QuoteStatusCardsProps {
  counts: Record<string, number>;
}

const STATUSES = [
  { key: "received", label: "Received", color: "text-emerald-400", barColor: "bg-emerald-500" },
  { key: "in_progress", label: "In Progress", color: "text-blue-400", barColor: "bg-blue-500" },
  { key: "awaiting_reply", label: "Awaiting Reply", color: "text-orange-400", barColor: "bg-orange-500" },
  { key: "just_sent", label: "Just Sent", color: "text-blue-400", barColor: "bg-blue-400" },
];

export function QuoteStatusCards({ counts }: QuoteStatusCardsProps) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Quote Pipeline Status</h3>
      <div className="grid grid-cols-2 gap-3">
        {STATUSES.map((s) => {
          const count = counts[s.key] || 0;
          const pct = total > 0 ? (count / total) * 100 : 0;

          return (
            <div key={s.key} className="rounded-lg border bg-card p-4">
              <div className={`text-2xl font-bold ${s.color}`}>{count}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {s.label}
              </div>
              <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${s.barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
