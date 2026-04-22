"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TimeRange } from "@/lib/time-range";

const RANGES: Array<{ key: TimeRange; label: string }> = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

export function TimeRangeSelector({
  currentRange,
  currentOffset,
  periodLabel,
  isCurrent,
}: {
  currentRange: TimeRange;
  currentOffset: number;
  periodLabel: string;
  isCurrent: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, start] = useTransition();

  const setParams = (range: TimeRange, offset: number) => {
    const next = new URLSearchParams(search?.toString() || "");
    if (range === "week" && offset === 0) {
      next.delete("range");
      next.delete("offset");
    } else {
      next.set("range", range);
      if (offset === 0) next.delete("offset");
      else next.set("offset", String(offset));
    }
    start(() => {
      router.replace(`?${next.toString()}`);
    });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="inline-flex items-center gap-0.5 rounded-full bg-muted/50 p-0.5 border border-border">
        {RANGES.map(r => {
          const active = r.key === currentRange;
          return (
            <button
              key={r.key}
              onClick={() => setParams(r.key, 0)}
              className={`px-3 py-1 rounded-full text-[12px] font-semibold transition-colors ${
                active
                  ? "bg-amber-600 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              disabled={pending}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <div className="inline-flex items-center gap-1">
        <button
          onClick={() => setParams(currentRange, currentOffset - 1)}
          className="h-7 w-7 rounded-md bg-card border border-border grid place-items-center text-muted-foreground hover:bg-muted"
          title="Previous"
          disabled={pending}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {!isCurrent && (
          <button
            onClick={() => setParams(currentRange, 0)}
            className="px-2.5 h-7 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-semibold hover:bg-amber-500/25"
            disabled={pending}
          >
            Today
          </button>
        )}
        <button
          onClick={() => setParams(currentRange, currentOffset + 1)}
          className="h-7 w-7 rounded-md bg-card border border-border grid place-items-center text-muted-foreground hover:bg-muted disabled:opacity-40"
          title="Next"
          disabled={pending || currentOffset >= 0}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className="text-[12px] text-muted-foreground font-medium">{periodLabel}</span>
      {!isCurrent && (
        <span className="text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">
          Past view
        </span>
      )}
    </div>
  );
}
