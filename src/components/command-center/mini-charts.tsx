"use client";

import { PieChart, Pie, Cell, BarChart, Bar, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

// ── MiniBarSegments ──────────────────────────────────────
// Pure CSS horizontal bar with colored proportional segments

interface BarSegment {
  label: string;
  value: number;
  color: string;
}

export function MiniBarSegments({ segments }: { segments: BarSegment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return null;

  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5">
        {segments.map((seg) =>
          seg.value > 0 ? (
            <div
              key={seg.label}
              className={cn("rounded-full", seg.color)}
              style={{ flex: seg.value }}
            />
          ) : null
        )}
      </div>
      <div className="flex gap-3 mt-1.5 flex-wrap">
        {segments.map((seg) =>
          seg.value > 0 ? (
            <span key={seg.label} className="text-[10px] text-muted-foreground flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full inline-block", seg.color)} />
              {seg.value} {seg.label}
            </span>
          ) : null
        )}
      </div>
    </div>
  );
}

// ── MiniDonut ──────────────────────────────────────
// Recharts PieChart as a tiny donut

interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

export function MiniDonut({ data }: { data: DonutSlice[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  return (
    <div className="flex items-center gap-3">
      <div className="h-12 w-12 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={14}
              outerRadius={22}
              strokeWidth={0}
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-0.5">
        {data.map((d) =>
          d.value > 0 ? (
            <span key={d.name} className="text-[10px] text-muted-foreground flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ backgroundColor: d.color }} />
              {d.value} {d.name}
            </span>
          ) : null
        )}
      </div>
    </div>
  );
}

// ── MiniSparkline ──────────────────────────────────────
// Recharts BarChart, tiny, no axes/labels

interface SparklinePoint {
  day: string;
  sent: number;
  received: number;
}

export function MiniSparkline({ data }: { data: SparklinePoint[] }) {
  return (
    <div className="h-8 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={1}>
          <Bar dataKey="sent" fill="#3b82f6" radius={[2, 2, 0, 0]} />
          <Bar dataKey="received" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Priority Badges ──────────────────────────────────────

interface PriorityBadgesProps {
  byPriority: Record<string, number>;
}

const priorityConfig: { key: string; label: string; color: string }[] = [
  { key: "urgent", label: "urgent", color: "bg-red-500/20 text-red-500" },
  { key: "high", label: "high", color: "bg-orange-500/20 text-orange-500" },
  { key: "medium", label: "medium", color: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400" },
  { key: "low", label: "low", color: "bg-gray-500/20 text-gray-500" },
];

export function PriorityBadges({ byPriority }: PriorityBadgesProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {priorityConfig.map(({ key, label, color }) => {
        const count = byPriority[key] || 0;
        if (count === 0) return null;
        return (
          <span key={key} className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", color)}>
            {count} {label}
          </span>
        );
      })}
    </div>
  );
}
