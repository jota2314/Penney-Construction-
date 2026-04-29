"use client";

import { useState, useTransition } from "react";
import { v } from "./tokens";
import { ClockOutSheet } from "./clock-out-sheet";
import type { TodayPhase } from "@/lib/actions/daily-logs";
import { clockInOnPhase } from "@/lib/actions/daily-logs";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function PhaseRow({ phase, onClockOut }: { phase: TodayPhase; onClockOut: (phase: TodayPhase) => void }) {
  const [pending, startTransition] = useTransition();
  const isOpen = !!phase.open_log_id;

  const handleClockIn = () => {
    startTransition(async () => {
      const res = await clockInOnPhase(phase.id);
      if (res.error) alert(res.error);
    });
  };

  return (
    <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-medium uppercase truncate" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>
          {phase.project_name}
        </div>
        <div className="text-[14px] font-semibold leading-tight mt-0.5 truncate" style={{ color: v("ink") }}>
          {phase.name}
        </div>
        {phase.line_item_description && (
          <div className="text-[12px] truncate mt-0.5" style={{ color: v("muted") }}>
            {phase.line_item_description}
          </div>
        )}
        {isOpen && phase.open_log_started_at && (
          <div className="inline-flex items-center gap-1.5 mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase" style={{ background: "rgba(52, 211, 153, 0.14)", color: "#34d399", letterSpacing: "0.12em" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
            Clocked in · {fmtTime(phase.open_log_started_at)}
          </div>
        )}
      </div>
      {isOpen ? (
        <button
          onClick={() => onClockOut(phase)}
          className="px-3.5 py-2 rounded-lg flex-shrink-0 text-[13px] font-semibold transition active:scale-[0.98]"
          style={{ background: v("accent"), color: "#1a0f00" }}
        >
          Clock out
        </button>
      ) : (
        <button
          onClick={handleClockIn}
          disabled={pending}
          className="px-3.5 py-2 rounded-lg flex-shrink-0 text-[13px] font-semibold transition active:scale-[0.98] disabled:opacity-50"
          style={{ background: v("bg-2"), color: v("ink"), border: `1px solid ${v("line")}` }}
        >
          {pending ? "Clocking in…" : "Clock in"}
        </button>
      )}
    </div>
  );
}

export function TodaysWorkCard({ phases }: { phases: TodayPhase[] }) {
  const [active, setActive] = useState<TodayPhase | null>(null);

  if (phases.length === 0) {
    return (
      <div className="rounded-2xl p-4" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
        <div className="text-[11px] font-medium uppercase mb-2" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>Today&apos;s work</div>
        <div className="text-[14px]" style={{ color: v("muted") }}>
          No phases scheduled for today.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl p-4" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[11px] font-medium uppercase" style={{ color: v("quiet"), letterSpacing: "0.18em" }}>Today&apos;s work</div>
          <div className="text-[12px]" style={{ color: v("muted") }}>{phases.length} {phases.length === 1 ? "phase" : "phases"}</div>
        </div>
        <div className="flex flex-col gap-2">
          {phases.map((p) => (
            <PhaseRow key={p.id} phase={p} onClockOut={setActive} />
          ))}
        </div>
      </div>
      {active?.open_log_id && (
        <ClockOutSheet
          logId={active.open_log_id}
          phaseLabel={`${active.project_name} · ${active.name}`}
          startedAt={active.open_log_started_at}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}
