import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubExceptionChip } from "@/lib/sub-portal/payload";
import type { SubVisitSource } from "@/lib/sub-portal/statuses";
import { coversDay } from "@/lib/sub-portal/et-day";
import { subDoesInspection } from "@/lib/schedule/trade-keywords";

/**
 * Shared by the sub capture routes (logs, logs/photo, clock, inspections):
 * the exception chips, the post → phase/line link, and the visit counter.
 * Server only; every caller passes the sub-portal service-role client.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

/** Longest note a post or shift keeps. */
export const MAX_POST_TEXT = 4000;

/** The chips' words, as the composer shows them and the feed reads them. */
export const EXCEPTION_LABELS: Record<SubExceptionChip, string> = {
  problem: "Problem found",
  waiting: "Waiting on something",
  finished: "Finished here",
};

const CHIP_ORDER: SubExceptionChip[] = ["problem", "waiting", "finished"];

/** The chips he tapped, cleaned: known ones only, each once, in a fixed order. */
export function parseExceptions(value: unknown): SubExceptionChip[] {
  if (!Array.isArray(value)) return [];
  const picked = new Set(value.map((v) => String(v ?? "").trim().toLowerCase()));
  return CHIP_ORDER.filter((chip) => picked.has(chip));
}

/**
 * The feed shows the post text, so a chip must read there too. The composer
 * normally writes the chip words into the text; any it didn't go on a first
 * line ("Problem found · Waiting on something"). A chips-only post is just
 * that line.
 */
export function withExceptionLabels(text: string, chips: SubExceptionChip[]): string {
  const lower = text.toLowerCase();
  const missing = chips.map((c) => EXCEPTION_LABELS[c]).filter((label) => !lower.includes(label.toLowerCase()));
  if (missing.length === 0) return text;
  return text ? `${missing.join(" · ")}\n${text}` : missing.join(" · ");
}

/** Schedule rows that are work (not an inspection, meeting or walkthrough). */
const WORK_EVENT_TYPES = new Set(["phase", "crew", "work"]);

export interface PhaseLink {
  schedule_phase_id?: string;
  estimate_line_item_id?: string;
  line_item_source?: "phase";
}

/**
 * Plan §3.3: when exactly one work phase covering today on this job is
 * assigned to him, the post (or shift) is that phase's work, so it carries
 * the phase and its budget line. A daily row under a master he is also on
 * counts once (the daily row wins: it's the specific day). Anything else —
 * no phase, two different phases — links nothing; the office can still
 * allocate it by hand. Never throws: a lookup failure means no link.
 */
export async function findPhaseLink(
  supabase: SupabaseClient,
  subId: string,
  projectId: string,
  day: string,
): Promise<PhaseLink> {
  try {
    const { data, error } = await supabase
      .from("schedule_phases")
      .select("id, event_type, start_date, end_date, estimate_line_item_id, master_phase_id")
      .eq("project_id", projectId)
      .contains("assigned_sub_ids", [subId])
      .lte("start_date", day)
      .or(`end_date.gte.${day},end_date.is.null`);
    if (error || !data) return {};

    type Row = {
      id: string;
      event_type: string | null;
      start_date: string | null;
      end_date: string | null;
      estimate_line_item_id: string | null;
      master_phase_id: string | null;
    };
    const covering = (data as Row[]).filter(
      (p) => coversDay(p.start_date, p.end_date, day) && (p.event_type == null || WORK_EVENT_TYPES.has(p.event_type)),
    );
    const parents = new Set(covering.map((p) => p.master_phase_id).filter(Boolean));
    const specific = covering.filter((p) => !parents.has(p.id));
    if (specific.length !== 1) return {};

    const phase = specific[0];
    let lineId = phase.estimate_line_item_id;
    if (!lineId && phase.master_phase_id) {
      const parent = covering.find((p) => p.id === phase.master_phase_id);
      if (parent) lineId = parent.estimate_line_item_id;
      else {
        const { data: master } = await supabase
          .from("schedule_phases")
          .select("estimate_line_item_id")
          .eq("id", phase.master_phase_id)
          .eq("project_id", projectId)
          .maybeSingle();
        lineId = (master?.estimate_line_item_id as string | null | undefined) ?? null;
      }
    }
    return lineId
      ? { schedule_phase_id: phase.id, estimate_line_item_id: lineId, line_item_source: "phase" }
      : { schedule_phase_id: phase.id };
  } catch {
    return {};
  }
}

/**
 * Count this on today's visit row (sub_record_visit, ET day set in SQL).
 * Returns true when it was his first touch at this job today, null if the
 * write failed: a missed count must never fail the post itself.
 */
export async function recordVisit(
  supabase: SupabaseClient,
  input: { projectId: string; subId: string; source: SubVisitSource; posts?: number; photos?: number },
): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("sub_record_visit", {
    p_project: input.projectId,
    p_sub: input.subId,
    p_worker: null,
    p_source: input.source,
    p_scans: 0,
    p_posts: input.posts ?? 0,
    p_photos: input.photos ?? 0,
  });
  if (error) {
    console.error("[sub-capture] sub_record_visit failed", error.message);
    return null;
  }
  return data === true;
}

/**
 * Is this inspection his trade? The shared rule (subDoesInspection in
 * trade-keywords.ts), the same one the job payload's SubInspection.my_trade
 * and the Dates inspection rows use. A final or building inspection names no
 * trade, so it is nobody's: it shows to him read-only.
 */
export function isMyTradeInspection(name: string | null | undefined, subTrades: readonly string[]): boolean {
  return subDoesInspection(subTrades, name);
}
