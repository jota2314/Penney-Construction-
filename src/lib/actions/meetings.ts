"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

interface MeetingInput {
  lead_id: string;
  scheduled_at: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export async function createMeeting(input: MeetingInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase
    .from("meetings")
    .insert({
      lead_id: input.lead_id,
      scheduled_at: input.scheduled_at,
      address: input.address || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
      status: "scheduled",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Update lead status
  await supabase
    .from("leads")
    .update({ status: "meeting_scheduled" })
    .eq("id", input.lead_id);

  revalidatePath("/crm");
  revalidatePath(`/crm/leads/${input.lead_id}`);
  return { error: null, id: data.id };
}

export async function updateMeeting(
  id: string,
  input: {
    scheduled_at?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const updateData: Record<string, unknown> = {};
  if (input.scheduled_at !== undefined)
    updateData.scheduled_at = input.scheduled_at;
  if (input.address !== undefined) updateData.address = input.address || null;
  if (input.city !== undefined) updateData.city = input.city || null;
  if (input.state !== undefined) updateData.state = input.state || null;
  if (input.zip !== undefined) updateData.zip = input.zip || null;

  const { error } = await supabase
    .from("meetings")
    .update(updateData)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/crm");
  return { error: null };
}

export async function deleteMeeting(id: string, leadId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("meetings").delete().eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/crm");
  revalidatePath(`/crm/leads/${leadId}`);
  return { error: null };
}

export async function completeMeeting(id: string, leadId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("meetings")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  // Update lead status
  await supabase
    .from("leads")
    .update({ status: "meeting_complete" })
    .eq("id", leadId);

  revalidatePath("/crm");
  revalidatePath(`/crm/leads/${leadId}`);
  revalidatePath(`/crm/meetings/${id}`);
  return { error: null };
}

export async function saveMeetingSummary(meetingId: string, summary: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("meetings")
    .update({ summary })
    .eq("id", meetingId);

  if (error) return { error: error.message };

  revalidatePath(`/crm/meetings/${meetingId}`);
  return { error: null };
}

export async function addMeetingNote(input: {
  meeting_id: string;
  content: string;
  source: "typed" | "voice";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Get next sort_order
  const { data: existing } = await supabase
    .from("meeting_notes")
    .select("sort_order")
    .eq("meeting_id", input.meeting_id)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSort =
    existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from("meeting_notes")
    .insert({
      meeting_id: input.meeting_id,
      content: input.content,
      source: input.source,
      sort_order: nextSort,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/crm/meetings/${input.meeting_id}`);
  return { error: null, note: data };
}

export async function updateMeetingNote(noteId: string, content: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("meeting_notes")
    .update({ content })
    .eq("id", noteId);

  if (error) return { error: error.message };

  return { error: null };
}

export async function deleteMeetingNote(noteId: string, meetingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("meeting_notes")
    .delete()
    .eq("id", noteId);

  if (error) return { error: error.message };

  revalidatePath(`/crm/meetings/${meetingId}`);
  return { error: null };
}
