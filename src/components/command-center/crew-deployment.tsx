"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, HardHat } from "lucide-react";
import Link from "next/link";

interface SchedulePhase {
  id: string;
  phase_name: string;
  project_name: string;
  project_id: string;
  project_address: string;
  start_date: string;
  end_date: string;
  status: string;
  assigned_to: string | null;
}

interface CrewDeploymentProps {
  phases: SchedulePhase[];
}

export function CrewDeployment({ phases }: CrewDeploymentProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <HardHat className="h-5 w-5 text-green-500" />
          <h3 className="font-semibold text-base">Crew Deployment This Week</h3>
          <Badge variant="secondary" className="text-xs">
            {phases.length} active
          </Badge>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="border-t">
          {phases.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No scheduled work this week.
            </div>
          ) : (
            <div className="divide-y">
              {phases.map((phase) => (
                <Link
                  key={phase.id}
                  href={`/command-center/${phase.project_id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {phase.project_name} — {phase.phase_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {phase.project_address}
                      {phase.assigned_to && ` \u00b7 ${phase.assigned_to}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">
                      {new Date(phase.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {" \u2013 "}
                      {new Date(phase.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                    <Badge
                      variant="outline"
                      className="text-[10px] mt-1"
                    >
                      {phase.status === "in_progress" ? "Active" : "Upcoming"}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
