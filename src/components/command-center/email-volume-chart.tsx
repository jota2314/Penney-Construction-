"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface EmailVolumeData {
  day: string;
  sent: number;
  received: number;
}

interface EmailVolumeChartProps {
  data: EmailVolumeData[];
}

export function EmailVolumeChart({ data }: EmailVolumeChartProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Email Volume (This Week)</h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={4}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--foreground))",
              }}
            />
            <Bar
              dataKey="sent"
              fill="hsl(217, 91%, 60%)"
              radius={[4, 4, 0, 0]}
              name="Sent"
            />
            <Bar
              dataKey="received"
              fill="hsl(280, 65%, 60%)"
              radius={[4, 4, 0, 0]}
              name="Received"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
