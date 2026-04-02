import { notFound } from "next/navigation";
import { getCrewProjectDetail } from "@/lib/actions/crew";
import { getFieldReport } from "@/lib/actions/field-reports";
import { getProjectCrewTasks } from "@/lib/actions/crew-tasks";
import { ClockInOutButton } from "@/components/crew/clock-in-out-button";
import { TimeEntryList } from "@/components/crew/time-entry-list";
import { ProjectMap } from "@/components/crew/project-map";
import { FieldReportPanel } from "@/components/crew/field-report-panel";
import { CrewTasksPanel } from "@/components/crew/crew-tasks-panel";
import { MapPin, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export default async function CrewProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getCrewProjectDetail(id);

  if (!data) return notFound();

  const { project, employee, timeEntries, activeEntry } = data;

  // Load field report if clocked in to this project
  const isClockedInHere = activeEntry?.project_id === project.id;
  const [fieldReport, crewTasks] = await Promise.all([
    isClockedInHere && activeEntry
      ? getFieldReport(activeEntry.id)
      : Promise.resolve(null),
    getProjectCrewTasks(project.id),
  ]);

  const location = [project.address, project.city, project.state]
    .filter(Boolean)
    .join(", ");

  const STATUS_COLORS: Record<string, string> = {
    contracted: "bg-blue-500",
    in_progress: "bg-green-500",
  };

  return (
    <div className="pb-4">
      {/* Back button */}
      <div className="px-4 pt-3">
        <Link
          href="/crew"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      {/* Project header */}
      <div className="px-4 pt-2 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold">{project.name}</h1>
          <Badge
            className={`${STATUS_COLORS[project.status] || "bg-zinc-500"} text-white text-[10px]`}
          >
            {project.status.replace(/_/g, " ")}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{project.project_number}</p>
        {location && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-2">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span>{location}</span>
          </div>
        )}
        {project.description && (
          <p className="text-sm text-muted-foreground mt-2 line-clamp-3">
            {project.description}
          </p>
        )}
      </div>

      {/* Map */}
      <div className="px-4 pb-4">
        <ProjectMap
          address={project.address}
          city={project.city}
          state={project.state}
          zip={project.zip}
          latitude={project.latitude}
          longitude={project.longitude}
        />
      </div>

      {/* Clock in/out */}
      <div className="px-4 pb-6">
        <ClockInOutButton
          employeeId={employee.id}
          projectId={project.id}
          activeEntryId={activeEntry?.id}
          activeEntryProjectId={activeEntry?.project_id}
          activeClockIn={activeEntry?.clock_in}
        />
      </div>

      {/* Assigned Tasks from PM */}
      {crewTasks.length > 0 && (
        <div className="px-4 pb-4">
          <CrewTasksPanel tasks={crewTasks} projectId={project.id} />
        </div>
      )}

      {/* Field Report — only when clocked in */}
      {isClockedInHere && activeEntry && (
        <div className="px-4 pb-6">
          <FieldReportPanel
            timeEntryId={activeEntry.id}
            projectId={project.id}
            projectName={project.name}
            existingPhotos={fieldReport?.photos || []}
            existingNotes={fieldReport?.notes || []}
          />
        </div>
      )}

      {/* Recent time entries */}
      <div className="px-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Recent Time (Last 14 Days)
        </h2>
        <TimeEntryList entries={timeEntries} />
      </div>
    </div>
  );
}
