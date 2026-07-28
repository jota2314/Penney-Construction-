"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEosContext } from "@/lib/eos/queries";
import type { EosActionResult } from "@/types/eos";

// ── V/TO ────────────────────────────────────────────────────────

const vtoSchema = z.object({
  coreValues: z
    .array(z.object({ title: z.string().trim().max(200), description: z.string().trim().max(2000) }))
    .max(10)
    .optional(),
  purpose: z.string().trim().max(2000).nullable().optional(),
  niche: z.string().trim().max(2000).nullable().optional(),
  tenYearTarget: z.string().trim().max(2000).nullable().optional(),
  targetMarket: z.string().trim().max(2000).nullable().optional(),
  threeUniques: z.array(z.string().trim().max(300)).max(5).optional(),
  provenProcess: z.string().trim().max(4000).nullable().optional(),
  guarantee: z.string().trim().max(2000).nullable().optional(),
  threeYearDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  threeYearRevenue: z.number().finite().nullable().optional(),
  threeYearProfit: z.number().finite().nullable().optional(),
  threeYearMeasurables: z.string().trim().max(2000).nullable().optional(),
  threeYearPicture: z.array(z.string().trim().max(500)).max(30).optional(),
  oneYearDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  oneYearRevenue: z.number().finite().nullable().optional(),
  oneYearProfit: z.number().finite().nullable().optional(),
  oneYearMeasurables: z.string().trim().max(2000).nullable().optional(),
  oneYearGoals: z.array(z.string().trim().max(500)).max(20).optional(),
});

/**
 * Patch the V/TO. Every field is optional so each card on the page can
 * save on its own without clobbering the rest — Vision Building Day 1
 * (2026-08-13) fills this in section by section.
 */
export async function saveVto(
  input: z.input<typeof vtoSchema>,
): Promise<EosActionResult> {
  const parsed = vtoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid V/TO." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const d = parsed.data;
  const patch: Record<string, unknown> = { updated_by: ctx.viewerId };

  const columns: Array<[keyof typeof d, string]> = [
    ["coreValues", "core_values"],
    ["purpose", "purpose"],
    ["niche", "niche"],
    ["tenYearTarget", "ten_year_target"],
    ["targetMarket", "target_market"],
    ["threeUniques", "three_uniques"],
    ["provenProcess", "proven_process"],
    ["guarantee", "guarantee"],
    ["threeYearDate", "three_year_date"],
    ["threeYearRevenue", "three_year_revenue"],
    ["threeYearProfit", "three_year_profit"],
    ["threeYearMeasurables", "three_year_measurables"],
    ["threeYearPicture", "three_year_picture"],
    ["oneYearDate", "one_year_date"],
    ["oneYearRevenue", "one_year_revenue"],
    ["oneYearProfit", "one_year_profit"],
    ["oneYearMeasurables", "one_year_measurables"],
    ["oneYearGoals", "one_year_goals"],
  ];

  for (const [key, column] of columns) {
    if (d[key] !== undefined) patch[column] = d[key] === "" ? null : d[key];
  }

  const { error } = await ctx.supabase
    .from("eos_vto")
    .upsert({ team_id: ctx.team.id, ...patch }, { onConflict: "team_id" });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/eos/vto");
  return { ok: true, data: null };
}

// ── Accountability Chart ────────────────────────────────────────

const seatSchema = z.object({
  name: z.string().trim().min(1, "Name the seat.").max(200),
  parentId: z.string().uuid().nullable().optional(),
  holderProfileId: z.string().uuid().nullable().optional(),
  holderName: z.string().trim().max(200).nullable().optional(),
  roles: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
});

export async function createSeat(
  input: z.input<typeof seatSchema>,
): Promise<EosActionResult<{ id: string }>> {
  const parsed = seatSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid seat." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { count } = await ctx.supabase
    .from("eos_seats")
    .select("id", { count: "exact", head: true })
    .eq("team_id", ctx.team.id);

  const { data, error } = await ctx.supabase
    .from("eos_seats")
    .insert({
      team_id: ctx.team.id,
      name: parsed.data.name,
      parent_id: parsed.data.parentId || null,
      holder_profile_id: parsed.data.holderProfileId || null,
      holder_name: parsed.data.holderName || null,
      roles: parsed.data.roles,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/eos/accountability");
  return { ok: true, data: { id: data.id } };
}

export async function updateSeat(
  input: z.input<typeof seatSchema> & { id: string },
): Promise<EosActionResult> {
  const parsed = seatSchema.extend({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid seat." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  if (parsed.data.parentId === parsed.data.id) {
    return { ok: false, error: "A seat cannot report to itself." };
  }

  const { error } = await ctx.supabase
    .from("eos_seats")
    .update({
      name: parsed.data.name,
      parent_id: parsed.data.parentId || null,
      holder_profile_id: parsed.data.holderProfileId || null,
      holder_name: parsed.data.holderName || null,
      roles: parsed.data.roles,
    })
    .eq("id", parsed.data.id)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/eos/accountability");
  return { ok: true, data: null };
}

export async function deleteSeat(seatId: string): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  // Children cascade in the DB — say so rather than surprising anyone.
  const { error } = await ctx.supabase
    .from("eos_seats")
    .delete()
    .eq("id", seatId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/eos/accountability");
  return { ok: true, data: null };
}

// ── Team settings ───────────────────────────────────────────────

export async function saveMeetingCadence(input: {
  meetingDay: number | null;
  meetingTime: string | null;
}): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  if (
    input.meetingDay !== null &&
    (!Number.isInteger(input.meetingDay) || input.meetingDay < 0 || input.meetingDay > 6)
  ) {
    return { ok: false, error: "Pick a day of the week." };
  }

  const { error } = await ctx.supabase
    .from("eos_teams")
    .update({
      meeting_day: input.meetingDay,
      meeting_time: input.meetingTime || null,
    })
    .eq("id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/eos");
  revalidatePath("/eos/meetings");
  return { ok: true, data: null };
}
