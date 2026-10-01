import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crewToday, scheduleDateLabel } from "@/lib/crew/schedule-dates";
import type { CrewJobHint } from "@/lib/crew/receipt-scan-types";

/**
 * Which job a crew member's receipt belongs to, read off their own time card.
 *
 * Most counter receipts carry no job name — the store prints "CASH CUSTOMER"
 * and the crew member is left hunting through every active job. But they were
 * on the clock when they bought it: Dylan's Town Line Paint slip (9/28 12:32)
 * sits inside his 8:53–12:35 White Kitchen shift. So the receipt's own date
 * and time point at the job, and the jobs worked that day are the short list
 * worth offering first.
 *
 * Deterministic on purpose — the model only reads the paper; this decides.
 */



type LogRow = {
  project_id: string | null;
  started_at: string;
  ended_at: string | null;
  status: string | null;
  phase: { project_id: string | null } | Array<{ project_id: string | null }> | null;
};

const TZ = "America/New_York";
/** Driving to the yard and back is still the job, so shifts get some slack. */
const SHIFT_SLACK_MS = 45 * 60_000;

function nyDate(iso: string): string {
  return crewToday(new Date(iso));
}

/** A wall-clock date + "HH:MM" in New York, as an instant. DST-safe. */
function nyInstant(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  const guess = Date.parse(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  if (!Number.isFinite(guess)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const shownAsNy = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return guess + (guess - shownAsNy);
}

function shortDate(date: string): string {
  return scheduleDateLabel(date, { month: "short", day: "numeric" });
}

function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function projectOf(row: LogRow): string | null {
  const phase = Array.isArray(row.phase) ? row.phase[0] : row.phase;
  return row.project_id ?? phase?.project_id ?? null;
}

export async function crewJobHints(
  supabase: SupabaseClient,
  profileId: string,
  receiptDate: string | null,
  receiptTime: string | null,
): Promise<{ match: CrewJobHint | null; jobs: CrewJobHint[] }> {
  const today = crewToday();
  const date = receiptDate && /^\d{4}-\d{2}-\d{2}$/.test(receiptDate) && receiptDate <= today
    ? receiptDate
    : today;
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString();
  const to = new Date(Date.parse(`${date}T00:00:00Z`) + 2 * 86_400_000).toISOString();

  const [{ data: dayRows }, { data: openRows }] = await Promise.all([
    supabase
      .from("daily_logs")
      .select("project_id, started_at, ended_at, status, phase:schedule_phases!schedule_phase_id(project_id)")
      .eq("author_id", profileId)
      .gte("started_at", from)
      .lt("started_at", to)
      .order("started_at", { ascending: true })
      .limit(60),
    supabase
      .from("daily_logs")
      .select("project_id, started_at, ended_at, status, phase:schedule_phases!schedule_phase_id(project_id)")
      .eq("author_id", profileId)
      .eq("status", "in_progress")
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  const sameDay = ((dayRows ?? []) as LogRow[]).filter((r) => nyDate(r.started_at) === date);
  const dayJobs = [...new Set(sameDay.map(projectOf).filter((id): id is string => Boolean(id)))];
  const openJob = ((openRows ?? []) as LogRow[]).map(projectOf).find(Boolean) ?? null;

  // The shift that covers the printed purchase time wins outright.
  let matchId: string | null = null;
  let matchReason = "";
  const at = receiptTime ? nyInstant(date, receiptTime) : null;
  if (at !== null) {
    const covering = [...new Set(
      sameDay
        .filter((r) => {
          const start = Date.parse(r.started_at) - SHIFT_SLACK_MS;
          const end = (r.ended_at ? Date.parse(r.ended_at) : Date.now()) + SHIFT_SLACK_MS;
          return at >= start && at <= end;
        })
        .map(projectOf)
        .filter((id): id is string => Boolean(id)),
    )];
    if (covering.length === 1) {
      matchId = covering[0];
      matchReason = `On the clock here ${shortDate(date)}, ${clock(receiptTime!)}`;
    }
  }
  if (!matchId && dayJobs.length === 1) {
    matchId = dayJobs[0];
    matchReason = `Your only job on ${shortDate(date)}`;
  }

  const ids = [...new Set([...(matchId ? [matchId] : []), ...dayJobs, ...(openJob ? [openJob] : [])])];
  if (ids.length === 0) return { match: null, jobs: [] };

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, project_number")
    .in("id", ids);
  const label = new Map(
    (projects ?? []).map((p) => [p.id, p.project_number ? `${p.project_number} ${p.name}` : p.name]),
  );

  const jobs: CrewJobHint[] = ids
    .filter((id) => label.has(id))
    .map((id) => ({
      id,
      label: label.get(id)!,
      reason: id === matchId
        ? matchReason
        : dayJobs.includes(id)
          ? `On your time card ${shortDate(date)}`
          : "Clocked in now",
    }));
  const match = matchId ? jobs.find((j) => j.id === matchId) ?? null : null;
  return { match, jobs: jobs.slice(0, 4) };
}
