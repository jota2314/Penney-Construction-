"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEosContext } from "@/lib/eos/queries";
import { weekEnding } from "@/lib/constants/eos";
import type { EosActionResult } from "@/types/eos";

/**
 * Write the proposals the meeting leader approved. The allocator already
 * id-validated everything against live records; this re-scopes every write to
 * the caller's team so an approved-but-stale id still can't cross teams.
 */

const segue = z.object({
  profileId: z.string().uuid(),
  personalBest: z.string().trim().max(2000).nullable(),
  businessBest: z.string().trim().max(2000).nullable(),
});

const applySchema = z.object({
  meetingId: z.string().uuid(),
  sectionKey: z.string().trim().min(1).max(40),
  segues: z.array(segue).max(30).default([]),
  scores: z
    .array(z.object({ measurableId: z.string().uuid(), value: z.number().finite() }))
    .max(40)
    .default([]),
  rockStatuses: z
    .array(
      z.object({
        rockId: z.string().uuid(),
        status: z.enum(["on_track", "off_track", "complete"]),
      }),
    )
    .max(40)
    .default([]),
  headlines: z
    .array(
      z.object({
        kind: z.enum(["customer", "employee"]),
        body: z.string().trim().min(1).max(600),
      }),
    )
    .max(30)
    .default([]),
  todoStatuses: z
    .array(z.object({ todoId: z.string().uuid(), status: z.enum(["done", "open"]) }))
    .max(60)
    .default([]),
  newTodos: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        ownerProfileId: z.string().uuid().nullable(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      }),
    )
    .max(40)
    .default([]),
  newIssues: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().trim().max(3000).nullable(),
        ownerProfileId: z.string().uuid().nullable(),
        term: z.enum(["short_term", "long_term"]),
      }),
    )
    .max(40)
    .default([]),
  solvedIssues: z
    .array(
      z.object({
        issueId: z.string().uuid(),
        solution: z.string().trim().min(1).max(3000),
      }),
    )
    .max(40)
    .default([]),
  ratings: z
    .array(z.object({ profileId: z.string().uuid(), rating: z.number().int().min(1).max(10) }))
    .max(30)
    .default([]),
  cascadingMessage: z.string().trim().max(4000).nullable().default(null),
});

export interface ApplySummary {
  applied: number;
  labels: string[];
}

function sevenDaysOut(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export async function applyMeetingAllocation(
  input: z.input<typeof applySchema>,
): Promise<EosActionResult<ApplySummary>> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid proposals." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const d = parsed.data;
  const teamId = ctx.team.id;
  const sb = ctx.supabase;

  const { data: meeting } = await sb
    .from("eos_meetings")
    .select("id, meeting_date")
    .eq("id", d.meetingId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };

  const labels: string[] = [];
  let applied = 0;

  // ── Segue ───────────────────────────────────────────────────
  for (const s of d.segues) {
    const { error } = await sb.from("eos_meeting_attendees").upsert(
      {
        meeting_id: d.meetingId,
        profile_id: s.profileId,
        personal_best: s.personalBest,
        business_best: s.businessBest,
      },
      { onConflict: "meeting_id,profile_id" },
    );
    if (error) return { ok: false, error: error.message };
    applied++;
  }
  if (d.segues.length) labels.push(`${d.segues.length} segue${d.segues.length > 1 ? "s" : ""}`);

  // ── Scorecard numbers ───────────────────────────────────────
  if (d.scores.length) {
    const week = weekEnding(new Date(`${meeting.meeting_date}T00:00:00Z`));
    const { data: mine } = await sb
      .from("eos_measurables")
      .select("id")
      .eq("team_id", teamId)
      .in("id", d.scores.map((s) => s.measurableId));
    const ok = new Set((mine ?? []).map((m) => m.id));

    for (const s of d.scores.filter((s) => ok.has(s.measurableId))) {
      const { error } = await sb.from("eos_scores").upsert(
        {
          measurable_id: s.measurableId,
          week_ending: week,
          value: s.value,
          entered_by: ctx.viewerId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "measurable_id,week_ending" },
      );
      if (error) return { ok: false, error: error.message };
      applied++;
    }
    labels.push(`${ok.size} number${ok.size > 1 ? "s" : ""}`);
  }

  // ── Rock statuses ───────────────────────────────────────────
  for (const r of d.rockStatuses) {
    const { error } = await sb
      .from("eos_rocks")
      .update({
        status: r.status,
        completed_at: r.status === "complete" ? new Date().toISOString() : null,
      })
      .eq("id", r.rockId)
      .eq("team_id", teamId);
    if (error) return { ok: false, error: error.message };
    applied++;
  }
  if (d.rockStatuses.length) {
    labels.push(`${d.rockStatuses.length} Rock status${d.rockStatuses.length > 1 ? "es" : ""}`);
  }

  // ── Headlines ───────────────────────────────────────────────
  if (d.headlines.length) {
    const { error } = await sb.from("eos_headlines").insert(
      d.headlines.map((h) => ({
        team_id: teamId,
        meeting_id: d.meetingId,
        kind: h.kind,
        body: h.body,
        created_by: ctx.viewerId,
      })),
    );
    if (error) return { ok: false, error: error.message };
    applied += d.headlines.length;
    labels.push(`${d.headlines.length} headline${d.headlines.length > 1 ? "s" : ""}`);
  }

  // ── To-do done / not done ───────────────────────────────────
  for (const t of d.todoStatuses) {
    const { error } = await sb
      .from("eos_todos")
      .update({
        status: t.status,
        completed_at: t.status === "done" ? new Date().toISOString() : null,
      })
      .eq("id", t.todoId)
      .eq("team_id", teamId);
    if (error) return { ok: false, error: error.message };
    applied++;
  }
  if (d.todoStatuses.length) {
    labels.push(`${d.todoStatuses.length} to-do update${d.todoStatuses.length > 1 ? "s" : ""}`);
  }

  // ── New to-dos ──────────────────────────────────────────────
  if (d.newTodos.length) {
    const { error } = await sb.from("eos_todos").insert(
      d.newTodos.map((t) => ({
        team_id: teamId,
        title: t.title,
        owner_profile_id: t.ownerProfileId,
        due_date: t.dueDate ?? sevenDaysOut(),
        meeting_id: d.meetingId,
        created_by: ctx.viewerId,
      })),
    );
    if (error) return { ok: false, error: error.message };
    applied += d.newTodos.length;
    labels.push(`${d.newTodos.length} new to-do${d.newTodos.length > 1 ? "s" : ""}`);
  }

  // ── New issues ──────────────────────────────────────────────
  if (d.newIssues.length) {
    const { error } = await sb.from("eos_issues").insert(
      d.newIssues.map((i) => ({
        team_id: teamId,
        title: i.title,
        description: i.description,
        owner_profile_id: i.ownerProfileId,
        term: i.term,
        meeting_id: d.meetingId,
        source: "meeting",
        created_by: ctx.viewerId,
      })),
    );
    if (error) return { ok: false, error: error.message };
    applied += d.newIssues.length;
    labels.push(`${d.newIssues.length} issue${d.newIssues.length > 1 ? "s" : ""}`);
  }

  // ── Solved issues ───────────────────────────────────────────
  for (const s of d.solvedIssues) {
    const { error } = await sb
      .from("eos_issues")
      .update({
        status: "solved",
        solution: s.solution,
        solved_at: new Date().toISOString(),
        priority: null,
        meeting_id: d.meetingId,
      })
      .eq("id", s.issueId)
      .eq("team_id", teamId);
    if (error) return { ok: false, error: error.message };
    applied++;
  }
  if (d.solvedIssues.length) {
    labels.push(`${d.solvedIssues.length} solved`);
  }

  // ── Ratings ─────────────────────────────────────────────────
  for (const r of d.ratings) {
    const { error } = await sb.from("eos_meeting_attendees").upsert(
      { meeting_id: d.meetingId, profile_id: r.profileId, rating: r.rating },
      { onConflict: "meeting_id,profile_id" },
    );
    if (error) return { ok: false, error: error.message };
    applied++;
  }
  if (d.ratings.length) {
    const { data: rated } = await sb
      .from("eos_meeting_attendees")
      .select("rating")
      .eq("meeting_id", d.meetingId)
      .not("rating", "is", null);
    const nums = (rated ?? []).map((x) => Number(x.rating));
    await sb
      .from("eos_meetings")
      .update({
        avg_rating: nums.length
          ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
          : null,
      })
      .eq("id", d.meetingId)
      .eq("team_id", teamId);
    labels.push(`${d.ratings.length} rating${d.ratings.length > 1 ? "s" : ""}`);
  }

  // ── Cascading message ───────────────────────────────────────
  if (d.cascadingMessage) {
    const { error } = await sb
      .from("eos_meetings")
      .update({ cascading_message: d.cascadingMessage })
      .eq("id", d.meetingId)
      .eq("team_id", teamId);
    if (error) return { ok: false, error: error.message };
    applied++;
    labels.push("cascading message");
  }

  await sb
    .from("eos_meeting_transcripts")
    .update({ applied_at: new Date().toISOString() })
    .eq("meeting_id", d.meetingId)
    .eq("section_key", d.sectionKey);

  revalidatePath("/eos");
  revalidatePath("/eos/rocks");
  revalidatePath("/eos/scorecard");
  revalidatePath("/eos/issues");
  revalidatePath("/eos/todos");
  revalidatePath(`/eos/meetings/${d.meetingId}`);

  return { ok: true, data: { applied, labels } };
}

/** Keep the running transcript for a section without asking the AI yet. */
export async function saveTranscript(
  meetingId: string,
  sectionKey: string,
  transcript: string,
): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { data: meeting } = await ctx.supabase
    .from("eos_meetings")
    .select("id")
    .eq("id", meetingId)
    .eq("team_id", ctx.team.id)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };

  const { error } = await ctx.supabase.from("eos_meeting_transcripts").upsert(
    {
      meeting_id: meetingId,
      section_key: sectionKey,
      transcript: transcript.slice(0, 24000),
      created_by: ctx.viewerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "meeting_id,section_key" },
  );
  if (error) return { ok: false, error: error.message };

  return { ok: true, data: null };
}
