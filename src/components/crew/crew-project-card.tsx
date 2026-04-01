"use client";

import Link from "next/link";
import { MapPin, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface CrewProjectCardProps {
  project: {
    id: string;
    name: string;
    project_number: string;
    address: string | null;
    city: string | null;
    state: string | null;
    status: string;
  };
  isActiveProject?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  contracted: "bg-blue-500",
  in_progress: "bg-green-500",
};

export function CrewProjectCard({
  project,
  isActiveProject,
}: CrewProjectCardProps) {
  const location = [project.address, project.city, project.state]
    .filter(Boolean)
    .join(", ");

  return (
    <Link href={`/crew/project/${project.id}`}>
      <Card
        className={`p-4 hover:border-amber-500/30 transition-all ${
          isActiveProject ? "border-green-500/50 bg-green-500/5" : ""
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">{project.name}</h3>
              {isActiveProject && (
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {project.project_number}
            </p>
            {location && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground mt-2">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{location}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {isActiveProject && (
              <Badge className="bg-green-500/15 text-green-500 text-[10px]">
                <Clock className="h-3 w-3 mr-1" />
                Active
              </Badge>
            )}
            <Badge
              className={`${STATUS_COLORS[project.status] || "bg-zinc-500"} text-white text-[10px]`}
            >
              {project.status.replace(/_/g, " ")}
            </Badge>
          </div>
        </div>
      </Card>
    </Link>
  );
}
