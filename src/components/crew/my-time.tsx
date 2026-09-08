"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { HoursStrip } from "@/components/field-feed/hours-strip";
import { JobClockInSheet } from "@/components/field-feed/job-clock-in-sheet";
import { TimeEntryList } from "@/components/crew/time-entry-list";
import { PCC_TOKENS } from "@/components/field-feed/tokens";
import type { HoursSummary, TimeLogEntry } from "@/lib/actions/daily-logs";

export function MyTime({ hours, entries }: { hours: HoursSummary; entries: TimeLogEntry[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pt-6 pb-28" style={PCC_TOKENS as CSSProperties}>
      <h1 className="text-2xl font-semibold">My time</h1>
      <HoursStrip key={hours.openLog?.id ?? "off"} summary={hours} />
      {!hours.openLog && <button type="button" onClick={() => setOpen(true)} className="w-full rounded-xl bg-amber-600 py-3 font-semibold text-white">Clock in</button>}
      <h2 className="text-lg font-semibold">Time log · last 14 days</h2>
      <TimeEntryList entries={entries} showProject />
      {open && <JobClockInSheet onClose={() => { setOpen(false); router.refresh(); }} />}
    </div>
  );
}
