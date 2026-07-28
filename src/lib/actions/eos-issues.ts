"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEosContext } from "@/lib/eos/queries";
import type { EosActionResult } from "@/types/eos";

function revalidate() {
  revalidatePath("/eos");
  revalidatePath("/eos/issues");
  revalidatePath("/eos/todos");
  revalidatePath("/eos/meetings");
}

// ── Issues ──────────────────────────────────────────────────────

const issueSchema = z.object({
  title: z.string().trim().min(1, "Describe the issue.").max(300),
  description: z.string().trim().max(4000).optional().nullable(),
  ownerProfileId: z.string().uuid().nullable().optional(),
  term: z.enum(["short_term", "long_term"]).default("short_term"),
  /** Where it came from — an off-track measurable, a Rock, a headline. */
  source: z.string().trim().max(40).default("manual"),
  sourceRef: z.string().uuid().nullable().optional(),
  meetingId: z.string().uuid().nullable().optional(),
});

export async function createIssue(
  input: z.input<typeof issueSchema>,
): Promise<EosActionResult<{ id: string }>> {
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid issue." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { data, error } = await ctx.supabase
    .from("eos_issues")
    .insert({
      team_id: ctx.team.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      owner_profile_id: parsed.data.ownerProfileId || null,
      term: parsed.data.term,
      source: parsed.data.source,
      source_ref: parsed.data.sourceRef || null,
      meeting_id: parsed.data.meetingId || null,
      created_by: ctx.viewerId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: { id: data.id } };
}

export async function updateIssue(
  input: z.input<typeof issueSchema> & { id: string },
): Promise<EosActionResult> {
  const parsed = issueSchema.extend({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid issue." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_issues")
    .update({
      title: parsed.data.title,
      description: parsed.data.description || null,
      owner_profile_id: parsed.data.ownerProfileId || null,
      term: parsed.data.term,
    })
    .eq("id", parsed.data.id)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

/**
 * IDS prioritisation: mark an issue 1, 2 or 3 for this meeting, or pass
 * null to take it out of the top three.
 */
export async function setIssuePriority(
  issueId: string,
  priority: 1 | 2 | 3 | null,
): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  // One issue per slot — clear whoever held it first.
  if (priority !== null) {
    const { error: clearError } = await ctx.supabase
      .from("eos_issues")
      .update({ priority: null })
      .eq("team_id", ctx.team.id)
      .eq("status", "open")
      .eq("priority", priority);
    if (clearError) return { ok: false, error: clearError.message };
  }

  const { error } = await ctx.supabase
    .from("eos_issues")
    .update({ priority })
    .eq("id", issueId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

export async function solveIssue(
  issueId: string,
  solution: string,
  meetingId?: string | null,
): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_issues")
    .update({
      status: "solved",
      solution: solution.trim() || null,
      solved_at: new Date().toISOString(),
      priority: null,
      meeting_id: meetingId || null,
    })
    .eq("id", issueId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

export async function setIssueStatus(
  issueId: string,
  status: "open" | "solved" | "dropped",
): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_issues")
    .update({
      status,
      solved_at: status === "solved" ? new Date().toISOString() : null,
      priority: status === "open" ? undefined : null,
    })
    .eq("id", issueId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

export async function deleteIssue(issueId: string): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_issues")
    .delete()
    .eq("id", issueId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

// ── To-dos ──────────────────────────────────────────────────────

/** EOS to-dos are 7-day commitments — default the due date to next week. */
function sevenDaysOut(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

const todoSchema = z.object({
  title: z.string().trim().min(1, "Describe the to-do.").max(300),
  description: z.string().trim().max(4000).optional().nullable(),
  ownerProfileId: z.string().uuid().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  meetingId: z.string().uuid().nullable().optional(),
});

export async function createTodo(
  input: z.input<typeof todoSchema>,
): Promise<EosActionResult<{ id: string }>> {
  const parsed = todoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid to-do." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { data, error } = await ctx.supabase
    .from("eos_todos")
    .insert({
      team_id: ctx.team.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      owner_profile_id: parsed.data.ownerProfileId || null,
      due_date: parsed.data.dueDate || sevenDaysOut(),
      meeting_id: parsed.data.meetingId || null,
      created_by: ctx.viewerId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: { id: data.id } };
}

export async function updateTodo(
  input: z.input<typeof todoSchema> & { id: string },
): Promise<EosActionResult> {
  const parsed = todoSchema.extend({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid to-do." };
  }

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_todos")
    .update({
      title: parsed.data.title,
      description: parsed.data.description || null,
      owner_profile_id: parsed.data.ownerProfileId || null,
      due_date: parsed.data.dueDate || null,
    })
    .eq("id", parsed.data.id)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

export async function setTodoStatus(
  todoId: string,
  status: "open" | "done" | "dropped",
): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_todos")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", todoId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

export async function deleteTodo(todoId: string): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_todos")
    .delete()
    .eq("id", todoId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

/**
 * A not-done to-do at the next L10 either carries over or becomes an
 * issue. This is the "becomes an issue" path.
 */
export async function escalateTodoToIssue(
  todoId: string,
): Promise<EosActionResult<{ issueId: string }>> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { data: todo } = await ctx.supabase
    .from("eos_todos")
    .select("id, title, description, owner_profile_id")
    .eq("id", todoId)
    .eq("team_id", ctx.team.id)
    .maybeSingle();

  if (!todo) return { ok: false, error: "To-do not found." };

  const { data: issue, error } = await ctx.supabase
    .from("eos_issues")
    .insert({
      team_id: ctx.team.id,
      title: todo.title,
      description: todo.description,
      owner_profile_id: todo.owner_profile_id,
      source: "todo",
      source_ref: todo.id,
      created_by: ctx.viewerId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await ctx.supabase
    .from("eos_todos")
    .update({ status: "dropped" })
    .eq("id", todoId)
    .eq("team_id", ctx.team.id);

  revalidate();
  return { ok: true, data: { issueId: issue.id } };
}

// ── Headlines ───────────────────────────────────────────────────

export async function createHeadline(input: {
  kind: "customer" | "employee";
  body: string;
  meetingId?: string | null;
}): Promise<EosActionResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Write the headline first." };

  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase.from("eos_headlines").insert({
    team_id: ctx.team.id,
    kind: input.kind,
    body,
    meeting_id: input.meetingId || null,
    created_by: ctx.viewerId,
  });

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}

export async function deleteHeadline(headlineId: string): Promise<EosActionResult> {
  const ctx = await getEosContext();
  if (!ctx) return { ok: false, error: "You are not on an EOS team." };

  const { error } = await ctx.supabase
    .from("eos_headlines")
    .delete()
    .eq("id", headlineId)
    .eq("team_id", ctx.team.id);

  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, data: null };
}
