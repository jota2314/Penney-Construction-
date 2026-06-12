import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push/send";
import { MAX_SHIFT_HOURS, MAX_SHIFT_MS } from "@/lib/crew/shift";

const DEFAULT_AUTO_TEXT =
  "Auto clocked out after 12h — the clock-out was missed, so the shift was capped at 12 hours. Please correct your hours if needed.";

export interface AutoClockOutResult {
  closed: number;
  notified: number;
  logs: { id: string; author_id: string }[];
}

/**
 * Find every daily_log still `in_progress` past the max shift length and close
 * it: cap `ended_at` at `started_at + MAX_SHIFT_HOURS` (not "now", so the
 * recorded shift is a sane 12h rather than however many days elapsed), flag it
 * `auto_clocked_out`, and push-notify the worker so they know to fix their hours.
 *
 * Idempotent and safe to run on a schedule — only acts on stale open logs.
 * Pass an admin client when running from cron so RLS doesn't hide other users'
 * logs.
 */
export async function autoCloseStaleLogs(
  supabase: SupabaseClient
): Promise<AutoClockOutResult> {
  const cutoffIso = new Date(Date.now() - MAX_SHIFT_MS).toISOString();

  const { data: stale } = await supabase
    .from("daily_logs")
    .select("id, author_id, started_at, text, schedule_phase_id")
    .eq("status", "in_progress")
    .lt("started_at", cutoffIso);

  if (!stale || stale.length === 0) return { closed: 0, notified: 0, logs: [] };

  // Resolve a friendly "Project · Phase" label for each log's notification.
  const phaseIds = Array.from(
    new Set(stale.map((l) => l.schedule_phase_id).filter(Boolean))
  ) as string[];
  const labelByPhase = new Map<string, string>();
  if (phaseIds.length > 0) {
    const { data: phases } = await supabase
      .from("schedule_phases")
      .select("id, name, projects:project_id(name)")
      .in("id", phaseIds);
    for (const p of phases ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proj = Array.isArray((p as any).projects) ? (p as any).projects[0] : (p as any).projects;
      labelByPhase.set(p.id, proj?.name ? `${proj.name} · ${p.name}` : p.name);
    }
  }

  let closed = 0;
  let notified = 0;
  const logs: AutoClockOutResult["logs"] = [];

  for (const log of stale) {
    const cappedEnd = new Date(
      new Date(log.started_at).getTime() + MAX_SHIFT_MS
    ).toISOString();

    const { error } = await supabase
      .from("daily_logs")
      .update({
        ended_at: cappedEnd,
        status: "completed",
        auto_clocked_out: true,
        text: log.text?.trim() ? log.text : DEFAULT_AUTO_TEXT,
        updated_at: new Date().toISOString(),
      })
      .eq("id", log.id)
      .eq("status", "in_progress"); // guard against a concurrent manual clock-out

    if (error) continue;
    closed++;
    logs.push({ id: log.id, author_id: log.author_id });

    const label = labelByPhase.get(log.schedule_phase_id) ?? "your job";
    try {
      const delivered = await sendPushToUser(supabase, log.author_id, {
        title: "Clocked out automatically",
        body: `You were still on the clock at ${label} after ${MAX_SHIFT_HOURS}h. We capped your shift at ${MAX_SHIFT_HOURS}h — open Time Log to fix your hours if that's wrong.`,
        url: "/crew/time-log",
        tag: `auto-clockout-${log.id}`,
      });
      if (delivered > 0) notified++;
    } catch {
      // Push not configured / no devices — closing the log is what matters.
    }
  }

  return { closed, notified, logs };
}
