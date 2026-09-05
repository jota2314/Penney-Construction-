"use client";
import { useState } from "react";
import {
  ScheduleGantt,
  type GanttPhase,
} from "@/components/schedule/schedule-gantt";
const names = [
  "Rough Framing",
  "Roofing",
  "Copper Flashing",
  "Rough Plumbing",
  "Insulation",
  "Window Install",
  "Exterior Siding",
  "Blueboard and Plaster",
  "Hardwood Flooring - Install + Kitchen Refinish",
  "Interior Painting",
  "Kitchen Install - Cabinets & Counters",
];
export default function Page() {
  const [phases, setPhases] = useState<GanttPhase[]>(
    names.map((name, i) => ({
      id: String(i),
      name,
      start_date: `2026-10-${String(1 + i * 2).padStart(2, "0")}`,
      end_date: `2026-10-${String(8 + i * 2).padStart(2, "0")}`,
      planned_start_date: null,
      planned_end_date: null,
      status: "not_started",
      color: ["#2563eb", "#b45309", "#0d9488", "#7c3aed"][i % 4],
      event_type: "phase",
      sort_order: i,
      notes: i === 8 ? "Confirm floor order quantity with Peter." : null,
    }))
  );
  const [fail, setFail] = useState(false);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  return (
    <main className="mx-auto max-w-6xl p-4 pt-16">
      <h1 className="mb-4 text-xl font-semibold">Project schedule</h1>
      <div className="mb-3 flex gap-3">
        <button onClick={() => setFail(!fail)}>
          Failure mode: {String(fail)}
        </button>
        <button onClick={() => setFocus({ id: "8", n: (focus?.n ?? 0) + 1 })}>
          Focus flooring
        </button>
      </div>
      <ScheduleGantt
        phases={phases}
        focus={focus}
        cascade={
          new Map([
            [
              "8",
              {
                id: "8",
                start_date: "2026-10-17",
                end_date: "2026-10-30",
                firm: false,
                slip_days: 6,
              },
            ],
          ])
        }
        links={[
          {
            fromId: "9",
            toId: "8",
            reason: "Finish floor goes in after the wet trades",
          },
          { fromId: "8", toId: "10", reason: "Cabinets set on finished floor" },
        ]}
        issues={
          new Map([
            [
              "8",
              [
                {
                  phaseId: "8",
                  rule: "finish-order",
                  severity: "conflict",
                  message:
                    "Flooring starts before Interior Painting finishes. Review the trade sequence.",
                },
              ],
            ],
          ])
        }
        onUpdatePhase={async (id, patch) => {
          await new Promise((r) => setTimeout(r, 500));
          if (fail) return false;
          setPhases((p) =>
            p.map((x) => (x.id === id ? { ...x, ...patch } : x))
          );
          return true;
        }}
        onStatusChange={async (id, status) => {
          if (fail) return false;
          setPhases((p) => p.map((x) => (x.id === id ? { ...x, status } : x)));
        }}
        onDeletePhase={async (id) => {
          if (!confirm("Delete phase?")) return "cancelled";
          if (fail) return false;
          setPhases((p) => p.filter((x) => x.id !== id));
          return true;
        }}
      />
    </main>
  );
}
