import { HardHat } from "lucide-react";
import { getCrewDashboardData } from "@/lib/actions/crew";
import { requireAuth } from "@/lib/auth/require-auth";
import { CrewFieldFeed } from "@/components/crew/crew-field-feed";

export default async function CrewDashboardPage() {
  const [user, data] = await Promise.all([requireAuth(), getCrewDashboardData()]);

  if (!data?.employee) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
        <HardHat className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold mb-2">Account Not Linked</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Your account hasn&apos;t been linked to an employee profile yet. Ask your supervisor to set up your crew access.
        </p>
      </div>
    );
  }

  const { employee, projects, activeEntry } = data;

  const firstName =
    user.profile?.full_name?.trim().split(/\s+/)[0] ??
    employee.first_name ??
    null;

  return (
    <CrewFieldFeed
      firstName={firstName}
      employeeId={employee.id}
      projects={projects}
      activeEntry={activeEntry}
    />
  );
}
