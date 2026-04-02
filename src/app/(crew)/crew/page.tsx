import { getCrewDashboardData } from "@/lib/actions/crew";
import { CrewProjectCard } from "@/components/crew/crew-project-card";
import { ActiveClockBanner } from "@/components/crew/active-clock-banner";
import { HardHat } from "lucide-react";

export default async function CrewDashboardPage() {
  const data = await getCrewDashboardData();

  if (!data?.employee) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
        <HardHat className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold mb-2">Account Not Linked</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Your account hasn&apos;t been linked to an employee profile yet. Ask
          your supervisor to set up your crew access.
        </p>
      </div>
    );
  }

  const { employee, projects, activeEntry, todayEarnedCents } = data;

  return (
    <div>
      {/* Active clock banner */}
      {activeEntry && (
        <ActiveClockBanner
          entryId={activeEntry.id}
          projectName={
            (activeEntry as { projects?: { name: string } }).projects?.name ||
            "Project"
          }
          clockInTime={activeEntry.clock_in}
          hourlyRate={employee.hourly_rate || 0}
          todayEarnedCents={todayEarnedCents}
        />
      )}

      {/* Greeting */}
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold">
          Hey, {employee.first_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {/* Assigned projects */}
      <div className="px-4 pt-2">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Your Projects ({projects.length})
        </h2>
        {projects.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <HardHat className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No projects assigned yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <CrewProjectCard
                key={project.id}
                project={project}
                isActiveProject={
                  activeEntry?.project_id === project.id
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
