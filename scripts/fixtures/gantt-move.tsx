import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ScheduleGantt,
  type GanttPhase,
} from "@/components/schedule/schedule-gantt";
import { cascadeSchedule } from "@/lib/schedule/cascade";
const initial = [
  {
    id: "anchor",
    name: "Confirmed framing",
    start_date: "2026-09-05",
    end_date: "2026-09-10",
    planned_start_date: "2026-09-01",
    planned_end_date: "2026-09-06",
    is_confirmed: true,
    status: "in_progress",
    color: "#2563eb",
    event_type: "phase",
    sort_order: 0,
  },
  {
    id: "floor",
    name: "Flooring",
    start_date: "2026-09-11",
    end_date: "2026-09-18",
    planned_start_date: "2026-09-11",
    planned_end_date: "2026-09-18",
    is_confirmed: false,
    status: "not_started",
    color: "#b45309",
    event_type: "phase",
    sort_order: 1,
  },
  {
    id: "final",
    name: "Final inspection",
    start_date: "2027-04-01",
    end_date: "2027-04-01",
    planned_start_date: null,
    planned_end_date: null,
    is_confirmed: false,
    status: "not_started",
    color: "#059669",
    event_type: "inspection",
    sort_order: 2,
  },
];
function App() {
  const [phases, setPhases] = useState<GanttPhase[]>(
    () => JSON.parse(localStorage.getItem("move-phases") || "null") || initial
  );
  const [fail, setFail] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <main style={{ padding: 16, maxWidth: 1100 }}>
      <button onClick={() => setFail(!fail)}>Fail saves: {String(fail)}</button>
      <output data-testid="count">{count}</output>
      <ScheduleGantt
        phases={phases}
        cascade={cascadeSchedule(
          phases.map((p) => ({ ...p, is_confirmed: p.is_confirmed ?? false }))
        )}
        onMovePhase={async (id, start, end) => {
          setCount((c) => c + 1);
          await new Promise((r) => setTimeout(r, 200));
          if (fail) return false;
          const next = phases.map((p) =>
            p.id === id
              ? {
                  ...p,
                  start_date: start,
                  end_date: end,
                  is_manually_scheduled: true,
                }
              : p
          );
          localStorage.setItem("move-phases", JSON.stringify(next));
          setPhases(next);
          return true;
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
