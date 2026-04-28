"use client";

import Link from "next/link";
import { MapPin, Clock, Navigation, ChevronRight } from "lucide-react";
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
    latitude?: number | null;
    longitude?: number | null;
  };
  isActiveProject?: boolean;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  contracted: { color: "bg-blue-500", label: "Contracted" },
  in_progress: { color: "bg-green-500", label: "In Progress" },
  estimating: { color: "bg-amber-500", label: "Estimating" },
  proposal_sent: { color: "bg-purple-500", label: "Proposal Sent" },
  lead: { color: "bg-zinc-500", label: "Lead" },
};

export function CrewProjectCard({
  project,
  isActiveProject,
}: CrewProjectCardProps) {
  const location = [project.address, project.city, project.state]
    .filter(Boolean)
    .join(", ");

  const status = STATUS_META[project.status] ?? {
    color: "bg-zinc-500",
    label: project.status.replace(/_/g, " "),
  };

  // Directions URL — Google Maps universal link works on iOS + Android
  const directionsUrl = project.latitude && project.longitude
    ? `https://www.google.com/maps/dir/?api=1&destination=${project.latitude},${project.longitude}`
    : location
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location)}`
    : null;

  return (
    <Card
      className={`overflow-hidden transition-all relative ${
        isActiveProject
          ? "border-green-500/50 bg-green-500/5"
          : "hover:border-amber-500/30"
      }`}
    >
      {/* Colored status edge */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-1 ${status.color}`}
        aria-hidden
      />

      <Link href={`/crew/project/${project.id}`} className="block pl-5 pr-4 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold leading-tight">{project.name}</h3>
              {isActiveProject && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-500 bg-green-500/15 rounded-full px-2 py-0.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  <Clock className="h-3 w-3" />
                  Clocked In
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span className="font-mono">{project.project_number}</span>
              <span>·</span>
              <span>{status.label}</span>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-1" />
        </div>

        {location && (
          <div className="flex items-start gap-2 mt-3 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{location}</span>
          </div>
        )}
      </Link>

      {directionsUrl && (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-center gap-2 border-t bg-muted/30 hover:bg-amber-500/10 active:bg-amber-500/20 transition-colors h-12 text-sm font-medium text-amber-600 dark:text-amber-400"
        >
          <Navigation className="h-4 w-4" />
          Get Directions
        </a>
      )}
    </Card>
  );
}
