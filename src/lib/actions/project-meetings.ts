"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface MeetingNote {
  content: string;
  source: "voice" | "typed";
  at: string;
}

export interface MeetingActionItem {
  description: string;
  priority: "low" | "medium" | "high";
  todo_id?: string | null;
}

export interface ProjectMeeting {
  id: string;
  project_id: string;
  title: string | null;
  meeting_date: string;
  attendees: string | null;
  notes: MeetingNote[];
  summary: string | null;
  action_items: MeetingActionItem[];
  status: "capturing" | "completed";
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function createProjectMeeting(projectId: string, title?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase
    .from("project_meetings")
    .insert({
      project_id: projectId,
      title: title?.trim() || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/meetings");
  return { error: null, id: data.id as string };
}

export async function appendMeetingNote(
  meetingId: string,
  content: string,
  source: "voice" | "typed"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!content.trim()) return { error: "Empty note" };

  const { data: meeting, error: fetchErr } = await supabase
    .from("project_meetings")
    .select("notes")
    .eq("id", meetingId)
    .single();
  if (fetchErr) return { error: fetchErr.message };

  const note: MeetingNote = {
    content: content.trim(),
    source,
    at: new Date().toISOString(),
  };
  const notes = [...((meeting.notes as MeetingNote[]) ?? []), note];

  const { error } = await supabase
    .from("project_meetings")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", meetingId);

  if (error) return { error: error.message };
  return { error: null, note, notes };
}

export async function removeMeetingNote(meetingId: string, index: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: meeting, error: fetchErr } = await supabase
    .from("project_meetings")
    .select("notes")
    .eq("id", meetingId)
    .single();
  if (fetchErr) return { error: fetchErr.message };

  const notes = [...((meeting.notes as MeetingNote[]) ?? [])];
  if (index < 0 || index >= notes.length) return { error: "Note not found" };
  notes.splice(index, 1);

  const { error } = await supabase
    .from("project_meetings")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", meetingId);

  if (error) return { error: error.message };
  return { error: null, notes };
}

/**
 * Save the reviewed summary + action items and mark the meeting completed.
 * Action items flagged with createTodo become open todos on the project.
 */
export async function finalizeProjectMeeting(
  meetingId: string,
  input: {
    title?: string;
    summary: string;
    actionItems: Array<{
      description: string;
      priority: "low" | "medium" | "high";
      createTodo: boolean;
    }>;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: meeting, error: fetchErr } = await supabase
    .from("project_meetings")
    .select("id, project_id")
    .eq("id", meetingId)
    .single();
  if (fetchErr) return { error: fetchErr.message };

  // Project + client name for todo context
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, customer:customers(first_name, last_name)")
    .eq("id", meeting.project_id)
    .single();
  const customer = project?.customer as unknown as
    | { first_name: string | null; last_name: string | null }
    | null;
  const clientName =
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
    "Client";

  const savedItems: MeetingActionItem[] = [];
  for (const item of input.actionItems) {
    if (!item.description.trim()) continue;
    let todoId: string | null = null;
    if (item.createTodo) {
      const { data: todo } = await supabase
        .from("todos")
        .insert({
          project_id: meeting.project_id,
          project_name: project?.name ?? null,
          contact_name: clientName,
          contact_type: "other",
          description: item.description.trim(),
          priority: item.priority,
          created_by: user.id,
        })
        .select("id")
        .single();
      todoId = todo?.id ?? null;
    }
    savedItems.push({
      description: item.description.trim(),
      priority: item.priority,
      todo_id: todoId,
    });
  }

  const { error } = await supabase
    .from("project_meetings")
    .update({
      title: input.title?.trim() || null,
      summary: input.summary.trim(),
      action_items: savedItems,
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", meetingId);

  if (error) return { error: error.message };

  revalidatePath("/meetings");
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath(`/projects/${meeting.project_id}`);
  return {
    error: null,
    todosCreated: savedItems.filter((i) => i.todo_id).length,
  };
}

export async function deleteProjectMeeting(meetingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("project_meetings")
    .delete()
    .eq("id", meetingId);

  if (error) return { error: error.message };
  revalidatePath("/meetings");
  return { error: null };
}
