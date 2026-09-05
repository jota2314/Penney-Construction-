import { getMyTimeLog } from "@/lib/actions/daily-logs";
import { TimeEntryList } from "@/components/crew/time-entry-list";
import { crewToday } from "@/lib/crew/schedule-dates";

export default async function CrewTimeLogPage() {
  // Read from the daily-logs clock (what the field app actually writes to),
  // not the legacy time_entries table.
  const entries = await getMyTimeLog(14);

  // Week total — Monday start, to match the Hours strip on the home screen.
  const monday = new Date(crewToday() + "T00:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);

  let weekMinutes = 0;
  for (const e of entries) {
    if (!e.clock_out) continue;
    const clockIn = new Date(e.clock_in);
    if (crewToday(clockIn) >= weekStart) {
      const ms = new Date(e.clock_out).getTime() - clockIn.getTime();
      weekMinutes += Math.max(0, Math.floor(ms / 60000) - e.break_minutes);
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
