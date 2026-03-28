"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";

interface ProjectCardData {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  phase: string | null;
  status: string;
  quote_count: number;
  next_action: string | null;
  progress: number;
  subcontractor_names: string[];
}

const PHASE_LABELS: Record<string, string> = {
  preconstruction: "PRECONSTRUCTION",
  pre_start: "PRE-START",
  rough_in: "ROUGH-IN",
  finishing: "FINISHING",
  punch_list: "PUNCH LIST",
  complete: "COMPLETE",
  lead: "NEW LEAD",
  estimating: "ESTIMATING",
  proposal_sent: "PROPOSAL SENT",
  contracted: "CONTRACTED",
  in_progress: "IN PROGRESS",
};

const PHASE_COLORS: Record<string, string> = {
  preconstruction: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  pre_start: "bg-red-500/20 text-red-400 border-red-500/30",
  rough_in: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  finishing: "bg-green-500/20 text-green-400 border-green-500/30",
  punch_list: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  complete: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  lead: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  estimating: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  proposal_sent: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  contracted: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  in_progress: "bg-green-500/20 text-green-400 border-green-500/30",
};

const PROGRESS_COLORS: Record<string, string> = {
  preconstruction: "bg-orange-500",
  pre_start: "bg-red-500",
  rough_in: "bg-yellow-500",
  finishing: "bg-green-500",
  punch_list: "bg-blue-500",
  complete: "bg-emerald-500",
  lead: "bg-blue-500",
  estimating: "bg-purple-500",
  proposal_sent: "bg-amber-500",
  contracted: "bg-emerald-500",
  in_progress: "bg-green-500",
};

interface ProjectBoardProps {
  projects: ProjectCardData[];
}

export function ProjectBoard({ projects }: ProjectBoardProps) {
  if (projects.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No active projects. Create a workflow to get started.
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Active Project Board</h3>
      <div className="space-y-3">
        {projects.map((project) => {
          const phaseKey = project.phase || project.status;
          const progressPercent = project.progress || getDefaultProgress(phaseKey);

          return (
            <Link
              key={project.id}
              href={`/command-center/${project.id}`}
              className="block"
            >
              <div className="rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors border-l-4 border-l-emerald-500">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold">{project.name}</h4>
                      <Badge
                        className={`text-[10px] font-bold tracking-wider ${
                          PHASE_COLORS[phaseKey] || PHASE_COLORS.lead
                        }`}
                        variant="outline"
                      >
                        {PHASE_LABELS[phaseKey] || phaseKey.toUpperCase()}
                      </Badge>
                    </div>
                    {(project.address || project.city) && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {[project.address, project.city]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                  {project.quote_count > 0 && (
                    <Badge
                      variant="outline"
                      className="text-emerald-400 border-emerald-500/30 shrink-0"
                    >
                      {project.quote_count} QUOTES
                    </Badge>
                  )}
                </div>

                {/* Progress bar */}
                <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      PROGRESS_COLORS[phaseKey] || "bg-blue-500"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Next action */}
                {project.next_action && (
                  <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1">
                    <ArrowRight className="h-3 w-3 text-orange-400" />
                    {project.next_action}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function getDefaultProgress(phase: string): number {
  const map: Record<string, number> = {
    lead: 5,
    estimating: 15,
    preconstruction: 25,
    proposal_sent: 35,
    pre_start: 40,
    contracted: 50,
    in_progress: 60,
    rough_in: 65,
    finishing: 80,
    punch_list: 90,
    complete: 100,
  };
  return map[phase] || 10;
}
