import { getCrewEmployee } from "@/lib/actions/crew";
import { getTimeEntries } from "@/lib/actions/time-entries";
import { TimeEntryList } from "@/components/crew/time-entry-list";
import { Clock } from "lucide-react";

export default async function CrewTimeLogPage() {
  const employee = await getCrewEmployee();

  if (!employee) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
        <Clock className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-sm text-muted-foreground">
          Account not linked to an employee profile.
        </p>
      </div>
    );
  }

  // Get entries for the last 14 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 14);

  const entries = await getTimeEntries(
    employee.id,
    startDate.toISOString(),
    endDate.toISOString()
  );

  // Calculate week total
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
  weekStart.setHours(0, 0, 0, 0);

  let weekMinutes = 0;
  for (const e of entries) {
    if (!e.clock_out) continue;
    const clockIn = new Date(e.clock_in);
    if (clockIn >= weekStart) {
      const ms =
        new Date(e.clock_out).getTime() - clockIn.getTime();
      weekMinutes += Math.floor(ms / 60000) - (e.break_minutes || 0);
    }
  }
  const weekHours = Math.floor(weekMinutes / 60);
  const weekMins = weekMinutes % 60;

  return (
    <div className="px-4 pt-4">
      <h1 className="text-xl font-bold mb-1">Time Log</h1>
      <p className="text-sm text-muted-foreground mb-4">Last 14 days</p>

      {/* Week summary */}
      <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 mb-6">
        <p className="text-xs text-muted-foreground mb-1">This Week</p>
        <p className="text-2xl font-mono font-bold text-amber-500">
          {weekHours}h {weekMins}m
        </p>
      </div>

      <TimeEntryList entries={entries} showProject />
    </div>
  );
}
