"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEosContext } from "@/lib/eos/queries";
import { L10_SECTIONS } from "@/lib/constants/eos";
import type { EosActionResult, EosSectionLogEntry } from "@/types/eos";

const SECTION_KEYS = L10_SECTIONS.map((s) => s.key);

function revalidate(meetingId?: string) {
  revalidatePath("/eos");
  revalidatePath("/eos/meetings");
  if (meetingId) revalidatePath(`/eos/meetings/${meetingId}`);
}

/**
 * Open the Level 10 for a given day. Idempotent: if someone already
 * started today's meeting, everyone else joins that same one rather
 * than creating a second row (the unique index on
 * (team_id, meeting_date) would reject it anyway).
 */
export async function startMeeting(
  meetingDate?: string,
): Promise<EosActionResult<{ id: string }>> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const date = meetingDate ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Bad meeting date." };
  }

  const { data: existing } = await ctx.supabase
    .from("eos_meetings")
    .select("id, status")
    .eq("team_id", ctx.team.id)
    .eq("meeting_date", date)
    .maybeSingle();

  let meetingId = existing?.id;

  if (!meetingId) {
    const { data, error } = await ctx.supabase
      .from("eos_meetings")
      .insert({
        team_id: ctx.team.id,
        meeting_date: date,
        status: "in_progress",
        started_at: new Date().toISOString(),
        current_section: SECTION_KEYS[0],
        section_started_at: new Date().toISOString(),
        section_log: [{ key: SECTION_KEYS[0], started_at: new Date().toISOString(), ended_at: null }],
        created_by: ctx.viewerId,
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };
    meetingId = data.id;
  } else if (existing?.status !== "in_progress") {
    const { error } = await ctx.supabase
      .from("eos_meetings")
      .update({
        status: "in_progress",
        started_at: new Date().toISOString(),
        current_section: SECTION_KEYS[0],
        section_started_at: new Date().toISOString(),
      })
      .eq("id", meetingId);
    if (error) return { ok: false, error: error.message };
  }

  // Seat the room. ctx.people is already deduped, so Jorge's two
  // profiles don't put him in the room twice.
  const { data: seated } = await ctx.supabase
    .from("eos_meeting_attendees")
    .select("profile_id")
    .eq("meeting_id", meetingId);

  const already = new Set((seated ?? []).map((r) => r.profile_id as string));
  const missing = ctx.people.filter((p) => !already.has(p.id));

  if (missing.length) {
    await ctx.supabase.from("eos_meeting_attendees").insert(
      missing.map((p) => ({
        meeting_id: meetingId,
        profile_id: p.id,
        is_present: true,
      })),
    );
  }

  revalidate(meetingId);
  return { ok: true, data: { id: meetingId } };
}

/**
 * Move the agenda on. Stamps the outgoing section's end time into
 * `section_log` so the team can see where the 90 minutes actually went —
 * IDS is supposed to get 60 of them.
 */
export async function setMeetingSection(
  meetingId: string,
  sectionKey: string,
): Promise<EosActionResult> {
  if (!SECTION_KEYS.includes(sectionKey)) {
    return { ok: false, error: "Unknown agenda section." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { data: meeting } = await ctx.supabase
    .from("eos_meetings")
    .select("id, section_log, current_section")
    .eq("id", meetingId)
    .eq("team_id", ctx.team.id)
    .maybeSingle();

  if (!meeting) return { ok: false, error: "Meeting not found." };
  if (meeting.current_section === sectionKey) return { ok: true, data: null };

  const now = new Date().toISOString();
  const log = [...((meeting.section_log ?? []) as EosSectionLogEntry[])];

  const open = log.findLast?.((entry) => entry.ended_at === null)
    ?? [...log].reverse().find((entry) => entry.ended_at === null);
  if (open) open.ended_at = now;

  log.push({ key: sectionKey, started_at: now, ended_at: null });

  const { error } = await ctx.supabase
    .from("eos_meetings")
    .update({
      current_section: sectionKey,
      section_started_at: now,
      section_log: log,
    })
    .eq("id", meetingId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate(meetingId);
  return { ok: true, data: null };
}

/** Segue: the viewer's own personal + business best for the week. */
export async function saveSegue(input: {
  meetingId: string;
  personalBest?: string | null;
  businessBest?: string | null;
}): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_meeting_attendees")
    .upsert(
      {
        meeting_id: input.meetingId,
        profile_id: ctx.viewerId,
        personal_best: input.personalBest?.trim() || null,
        business_best: input.businessBest?.trim() || null,
      },
      { onConflict: "meeting_id,profile_id" },
    );

  if (error) return { ok: false, error: error.message };

  revalidate(input.meetingId);
  return { ok: true, data: null };
}

export async function setAttendance(
  meetingId: string,
  profileId: string,
  isPresent: boolean,
): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_meeting_attendees")
    .upsert(
      { meeting_id: meetingId, profile_id: profileId, is_present: isPresent },
      { onConflict: "meeting_id,profile_id" },
    );

  if (error) return { ok: false, error: error.message };

  revalidate(meetingId);
  return { ok: true, data: null };
}

/** Conclude: everyone scores the meeting 1-10. */
export async function rateMeeting(
  meetingId: string,
  rating: number,
): Promise<EosActionResult> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    return { ok: false, error: "Rate the meeting 1 to 10." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_meeting_attendees")
    .upsert(
      { meeting_id: meetingId, profile_id: ctx.viewerId, rating },
      { onConflict: "meeting_id,profile_id" },
    );

  if (error) return { ok: false, error: error.message };

  await recomputeAvgRating(meetingId);
  revalidate(meetingId);
  return { ok: true, data: null };
}

async function recomputeAvgRating(meetingId: string) {
  const ctx = await getEosContext();
  if (!ctx) return;

  const { data } = await ctx.supabase
    .from("eos_meeting_attendees")
    .select("rating")
    .eq("meeting_id", meetingId)
    .not("rating", "is", null);

  const ratings = (data ?? []).map((r) => Number(r.rating));
  const avg = ratings.length
    ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
    : null;

  await ctx.supabase
    .from("eos_meetings")
    .update({ avg_rating: avg })
    .eq("id", meetingId)
    .eq("team_id", ctx.team.id);
}

const concludeSchema = z.object({
  meetingId: z.string().uuid(),
  cascadingMessage: z.string().trim().max(4000).optional().nullable(),
  notes: z.string().trim().max(20000).optional().nullable(),
});

export async function concludeMeeting(
  input: z.input<typeof concludeSchema>,
): Promise<EosActionResult> {
  const parsed = concludeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { data: meeting } = await ctx.supabase
    .from("eos_meetings")
    .select("section_log")
    .eq("id", parsed.data.meetingId)
    .eq("team_id", ctx.team.id)
    .maybeSingle();

  if (!meeting) return { ok: false, error: "Meeting not found." };

  const now = new Date().toISOString();
  const log = [...((meeting.section_log ?? []) as EosSectionLogEntry[])];
  for (const entry of log) {
    if (entry.ended_at === null) entry.ended_at = now;
  }

  const { error } = await ctx.supabase
    .from("eos_meetings")
    .update({
      status: "completed",
      ended_at: now,
      current_section: null,
      section_started_at: null,
      section_log: log,
      cascading_message: parsed.data.cascadingMessage || null,
      notes: parsed.data.notes || null,
    })
    .eq("id", parsed.data.meetingId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate(parsed.data.meetingId);
  return { ok: true, data: null };
}

export async function saveMeetingNotes(
  meetingId: string,
  notes: string,
): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_meetings")
    .update({ notes: notes.trim() || null })
    .eq("id", meetingId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate(meetingId);
  return { ok: true, data: null };
}

export async function deleteMeeting(meetingId: string): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_meetings")
    .delete()
    .eq("id", meetingId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}
