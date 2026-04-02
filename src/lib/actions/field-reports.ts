"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function addFieldReportPhoto(
  timeEntryId: string,
  projectId: string,
  storagePath: string,
  fileName: string,
  fileSize: number,
  mimeType: string,
  photoType: string,
  caption?: string
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.from("field_report_photos").insert({
    time_entry_id: timeEntryId,
    project_id: projectId,
    storage_path: storagePath,
    file_name: fileName,
    file_size: fileSize,
    mime_type: mimeType,
    photo_type: photoType,
    caption: caption || null,
    uploaded_by: user.id,
  });

  if (error) return { error: error.message };
  revalidatePath("/crew");
  return { error: null };
}

export async function addFieldReportNote(
  timeEntryId: string,
  projectId: string,
  content: string,
  noteType: string = "general",
  source: string = "typed"
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase
    .from("field_report_notes")
    .insert({
      time_entry_id: timeEntryId,
      project_id: projectId,
      content,
      note_type: noteType,
      source,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message, id: null };
  revalidatePath("/crew");
  return { error: null, id: data?.id };
}

export async function deleteFieldReportPhoto(photoId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("field_report_photos")
    .delete()
    .eq("id", photoId);
  if (error) return { error: error.message };
  revalidatePath("/crew");
  return { error: null };
}

export async function deleteFieldReportNote(noteId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("field_report_notes")
    .delete()
    .eq("id", noteId);
  if (error) return { error: error.message };
  revalidatePath("/crew");
  return { error: null };
}

export async function getFieldReport(timeEntryId: string) {
  const supabase = await createClient();

  const [photosRes, notesRes] = await Promise.all([
    supabase
      .from("field_report_photos")
      .select("*")
      .eq("time_entry_id", timeEntryId)
      .order("created_at"),
    supabase
      .from("field_report_notes")
      .select("*")
      .eq("time_entry_id", timeEntryId)
      .order("created_at"),
  ]);

  return {
    photos: photosRes.data ?? [],
    notes: notesRes.data ?? [],
  };
}
