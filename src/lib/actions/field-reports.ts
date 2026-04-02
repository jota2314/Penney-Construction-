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

  // Auto-create a todo for problems and material requests
  if (noteType === "problem" || noteType === "material_needed") {
    // Get employee name for the todo
    const { data: employee } = await supabase
      .from("employees")
      .select("first_name, last_name")
      .eq("profile_id", user.id)
      .single();

    const employeeName = employee
      ? `${employee.first_name} ${employee.last_name}`
      : "Field crew";

    // Get project name
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single();

    const category = noteType === "problem" ? "general" : "materials";
    const priority = noteType === "problem" ? "high" : "medium";
    const description =
      noteType === "problem"
        ? `FIELD PROBLEM reported by ${employeeName}: ${content}`
        : `MATERIAL REQUEST from ${employeeName}: ${content}`;

    await supabase.from("todos").insert({
      project_id: projectId,
      project_name: project?.name || null,
      contact_name: employeeName,
      contact_type: "internal",
      description,
      priority,
      category,
      source: "field_report",
      status: "open",
      created_by: user.id,
    });
  }

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
