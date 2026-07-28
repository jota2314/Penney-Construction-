"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEosContext } from "@/lib/eos/queries";
import type { EosActionResult } from "@/types/eos";

const ROCK_STATUSES = ["on_track", "off_track", "complete", "incomplete"] as const;

const rockSchema = z.object({
  title: z.string().trim().min(1, "Give the Rock a title.").max(300),
  description: z.string().trim().max(4000).optional().nullable(),
  ownerProfileId: z.string().uuid().nullable().optional(),
  type: z.enum(["company", "individual"]).default("company"),
  quarter: z.string().trim().regex(/^Q[1-4] \d{4}$/, "Quarter must look like 'Q3 2026'."),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(ROCK_STATUSES).default("on_track"),
});

function revalidate() {
  revalidatePath("/eos");
  revalidatePath("/eos/rocks");
}

export async function createRock(
  input: z.input<typeof rockSchema>,
): Promise<EosActionResult<{ id: string }>> {
  const parsed = rockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid Rock." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { data, error } = await ctx.supabase
    .from("eos_rocks")
    .insert({
      team_id: ctx.team.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      owner_profile_id: parsed.data.ownerProfileId || null,
      type: parsed.data.type,
      quarter: parsed.data.quarter,
      due_date: parsed.data.dueDate || null,
      status: parsed.data.status,
      created_by: ctx.viewerId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: { id: data.id } };
}

export async function updateRock(
  input: z.input<typeof rockSchema> & { id: string },
): Promise<EosActionResult> {
  const parsed = rockSchema.extend({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid Rock." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_rocks")
    .update({
      title: parsed.data.title,
      description: parsed.data.description || null,
      owner_profile_id: parsed.data.ownerProfileId || null,
      type: parsed.data.type,
      quarter: parsed.data.quarter,
      due_date: parsed.data.dueDate || null,
      status: parsed.data.status,
      completed_at: parsed.data.status === "complete" ? new Date().toISOString() : null,
    })
    .eq("id", parsed.data.id)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

/**
 * The Rock Review move: each owner calls on-track or off-track. Kept as
 * its own action because it fires straight off a button in the L10 runner.
 */
export async function setRockStatus(
  rockId: string,
  status: (typeof ROCK_STATUSES)[number],
): Promise<EosActionResult> {
  if (!ROCK_STATUSES.includes(status)) {
    return { ok: false, error: "Unknown Rock status." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_rocks")
    .update({
      status,
      completed_at: status === "complete" ? new Date().toISOString() : null,
    })
    .eq("id", rockId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  revalidatePath("/eos/meetings");
  return { ok: true, data: null };
}

export async function deleteRock(rockId: string): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_rocks")
    .delete()
    .eq("id", rockId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

// ── Milestones ──────────────────────────────────────────────────

export async function addMilestone(
  rockId: string,
  title: string,
  dueDate?: string | null,
): Promise<EosActionResult> {
  const clean = title.trim();
  if (!clean) return { ok: false, error: "Give the milestone a title." };

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  // Confirm the Rock is on the caller's team before hanging a child off it —
  // eos_rock_milestones has no team_id of its own to scope the write.
  const { data: rock } = await ctx.supabase
    .from("eos_rocks")
    .select("id")
    .eq("id", rockId)
    .eq("team_id", ctx.team.id)
    .maybeSingle();
  if (!rock) return { ok: false, error: "Rock not found." };

  const { count } = await ctx.supabase
    .from("eos_rock_milestones")
    .select("id", { count: "exact", head: true })
    .eq("rock_id", rockId);

  const { error } = await ctx.supabase.from("eos_rock_milestones").insert({
    rock_id: rockId,
    title: clean,
    due_date: dueDate || null,
    sort_order: count ?? 0,
  });

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

export async function toggleMilestone(
  milestoneId: string,
  isDone: boolean,
): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_rock_milestones")
    .update({
      is_done: isDone,
      completed_at: isDone ? new Date().toISOString() : null,
    })
    .eq("id", milestoneId);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

export async function deleteMilestone(milestoneId: string): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_rock_milestones")
    .delete()
    .eq("id", milestoneId);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}
