"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface ProjectCard {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  status: string;
  project_type: string | null;
  estimated_value: number | null;
  progress: number | null;
  phase: string | null;
  quote_count: number;
  pending_quotes: number;
  next_action: string | null;
}

interface ProjectStatusBoardProps {
  projects: ProjectCard[];
  onOpenChat: (context: { projectId: string; projectName: string }) => void;
}

const statusLabels: Record<string, string> = {
  lead: "Lead",
  estimating: "Estimating",
  proposal_sent: "Proposal Sent",
  contracted: "Contracted",
  in_progress: "In Progress",
};

const statusColors: Record<string, string> = {
  lead: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  estimating: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  proposal_sent: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  contracted: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  in_progress: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

export function ProjectStatusBoard({ projects, onOpenChat }: ProjectStatusBoardProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <FolderKanban className="h-5 w-5 text-blue-500" />
          <h3 className="font-semibold text-base">Active Projects</h3>
          <Badge variant="secondary" className="text-xs">
            {projects.length}
          </Badge>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="border-t p-4">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No active projects.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/command-center/${project.id}`}
                  className="rounded-lg border bg-background p-4 hover:border-amber-400/50 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-medium text-sm truncate group-hover:text-amber-600 transition-colors">
                      {project.name}
                    </h4>
                    <Badge className={cn("text-[10px] shrink-0", statusColors[project.status])}>
                      {statusLabels[project.status] || project.status}
                    </Badge>
                  </div>

                  {project.address && (
                    <p className="text-xs text-muted-foreground truncate mb-2">
                      {project.address}{project.city ? `, ${project.city}` : ""}
                    </p>
                  )}

                  {/* Progress bar */}
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full bg-amber-500 transition-all"
                      style={{ width: `${project.progress || 0}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {project.quote_count} quote{project.quote_count !== 1 ? "s" : ""}
                      {project.pending_quotes > 0 && (
                        <span className="text-amber-600"> ({project.pending_quotes} pending)</span>
                      )}
                    </span>
                    {project.estimated_value && (
                      <span className="font-medium">
                        ${(project.estimated_value / 1000).toFixed(0)}k
                      </span>
                    )}
                  </div>

                  {project.next_action && (
                    <p className="text-xs text-amber-600 mt-2 truncate">
                      Next: {project.next_action}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
