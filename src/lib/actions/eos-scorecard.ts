"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEosContext } from "@/lib/eos/queries";
import type { EosActionResult } from "@/types/eos";

const measurableSchema = z.object({
  name: z.string().trim().min(1, "Give the measurable a name.").max(300),
  description: z.string().trim().max(2000).optional().nullable(),
  ownerProfileId: z.string().uuid().nullable().optional(),
  unit: z.enum(["number", "currency", "percentage", "yes_no", "duration"]).default("number"),
  // Null is meaningful: several Penney measurables came out of Focus Day
  // with the goal still to be agreed at an L10.
  goalTarget: z.number().finite().nullable().optional(),
  comparison: z.enum([">=", "<=", "=", ">", "<"]).default(">="),
  cadence: z.enum(["weekly", "monthly", "quarterly"]).default("weekly"),
});

function revalidate() {
  revalidatePath("/eos");
  revalidatePath("/eos/scorecard");
}

export async function createMeasurable(
  input: z.input<typeof measurableSchema>,
): Promise<EosActionResult<{ id: string }>> {
  const parsed = measurableSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid measurable." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { count } = await ctx.supabase
    .from("eos_measurables")
    .select("id", { count: "exact", head: true })
    .eq("team_id", ctx.team.id);

  const { data, error } = await ctx.supabase
    .from("eos_measurables")
    .insert({
      team_id: ctx.team.id,
      name: parsed.data.name,
      description: parsed.data.description || null,
      owner_profile_id: parsed.data.ownerProfileId || null,
      unit: parsed.data.unit,
      goal_target: parsed.data.goalTarget ?? null,
      comparison: parsed.data.comparison,
      cadence: parsed.data.cadence,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: { id: data.id } };
}

export async function updateMeasurable(
  input: z.input<typeof measurableSchema> & { id: string },
): Promise<EosActionResult> {
  const parsed = measurableSchema
    .extend({ id: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid measurable." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_measurables")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      owner_profile_id: parsed.data.ownerProfileId || null,
      unit: parsed.data.unit,
      goal_target: parsed.data.goalTarget ?? null,
      comparison: parsed.data.comparison,
      cadence: parsed.data.cadence,
    })
    .eq("id", parsed.data.id)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

/** Scorecard rows are archived, never deleted — the history stays worth reading. */
export async function archiveMeasurable(id: string): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_measurables")
    .update({ is_active: false })
    .eq("id", id)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

const scoreSchema = z.object({
  measurableId: z.string().uuid(),
  weekEnding: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bad week."),
  value: z.number().finite().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Enter (or clear) one week's number. Upsert on
 * (measurable_id, week_ending) so re-entering a week corrects it
 * instead of stacking duplicate cells.
 */
export async function upsertScore(
  input: z.input<typeof scoreSchema>,
): Promise<EosActionResult> {
  const parsed = scoreSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid score." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  // The measurable carries the team scope; the score row does not.
  const { data: measurable } = await ctx.supabase
    .from("eos_measurables")
    .select("id")
    .eq("id", parsed.data.measurableId)
    .eq("team_id", ctx.team.id)
    .maybeSingle();
  if (!measurable) return { ok: false, error: "Measurable not found." };

  const { error } = await ctx.supabase.from("eos_scores").upsert(
    {
      measurable_id: parsed.data.measurableId,
      week_ending: parsed.data.weekEnding,
      value: parsed.data.value,
      note: parsed.data.note || null,
      entered_by: ctx.viewerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "measurable_id,week_ending" },
  );

  if (error) return { ok: false, error: error.message };

  revalidate();
  revalidatePath("/eos/meetings");
  return { ok: true, data: null };
}

export async function reorderMeasurables(
  orderedIds: string[],
): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  for (const [index, id] of orderedIds.entries()) {
    const { error } = await ctx.supabase
      .from("eos_measurables")
      .update({ sort_order: index })
      .eq("id", id)
      .eq("team_id", ctx.team.id);
    if (error) return { ok: false, error: error.message };
  }

  revalidate();
  return { ok: true, data: null };
}
