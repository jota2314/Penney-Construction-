import { HardHat } from "lucide-react";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { getMyUpcomingPhases, listRecentDailyLogs, getMyHoursSummary } from "@/lib/actions/daily-logs";
import { crewToday } from "@/lib/crew/schedule-dates";
import { CrewFlow } from "@/components/crew/crew-flow";

export default async function CrewDashboardPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  const profileId = user.profile?.id ?? user.id;

  // Find the employee row tied to the signed-in profile.
  const { data: employee } = await supabase
    .from("employees")
    .select("id, first_name, last_name")
    .eq("profile_id", profileId)
    .single();

  if (!employee) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
        <HardHat className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold mb-2">Account not linked</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Your account isn&apos;t linked to an employee profile yet. Ask your supervisor to set up your crew access.
        </p>
      </div>
    );
  }

  // Upcoming assigned work + recent daily-log posts (everyone)
  // + the worker's own hours summary for the strip at the top.
  const [schedule, logs, hours] = await Promise.all([
    getMyUpcomingPhases().then((result) => ({ ...result, unavailable: false })).catch(() => ({ today: crewToday(), phases: [], unavailable: true })),
    listRecentDailyLogs(20).catch(() => []),
    getMyHoursSummary().catch(() => ({ todayMinutes: 0, weekMinutes: 0, openLog: null })),
  ]);

  const firstName =
    user.profile?.full_name?.trim().split(/\s+/)[0] ??
    employee.first_name ??
    null;

  return <CrewFlow firstName={firstName} phases={schedule.phases} scheduleToday={schedule.today} scheduleUnavailable={schedule.unavailable} logs={logs} hours={hours} />;
}
