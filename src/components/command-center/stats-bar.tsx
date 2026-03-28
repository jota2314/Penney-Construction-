"use client";

interface StatsBarProps {
  activeJobs: number;
  followUps: number;
  quotesOut: number;
  updatesSent: number;
  totalClients: number;
}

export function StatsBar({
  activeJobs,
  followUps,
  quotesOut,
  updatesSent,
  totalClients,
}: StatsBarProps) {
  const stats = [
    { label: "ACTIVE JOBS", value: activeJobs, color: "text-blue-400" },
    { label: "FOLLOW-UPS", value: followUps, color: "text-purple-400" },
    { label: "QUOTES OUT", value: quotesOut, color: "text-emerald-400" },
    {
      label: "UPDATES SENT",
      value: `${updatesSent}/${totalClients}`,
      color:
        updatesSent >= totalClients ? "text-yellow-400" : "text-orange-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-lg border bg-card p-4 text-center"
        >
          <div className={`text-3xl font-bold ${stat.color}`}>
            {stat.value}
          </div>
          <div className="text-xs text-muted-foreground font-medium tracking-wide mt-1">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}
