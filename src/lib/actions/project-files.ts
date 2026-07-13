"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { canManageProjectDocuments } from "@/lib/auth/project-document-access";
import { createClient } from "@/lib/supabase/server";

const projectIdSchema = z.string().uuid();
const uploadCategorySchema = z.enum([
  "construction_drawings",
  "specs",
  "pricing",
  "contracts",
  "permits",
  "photos",
  "quotes",
  "invoices",
  "estimates",
  "other",
]);
// The Files tab lets a manager re-file an uploaded document into any of the
// real categories, so recategorization accepts the same full set as upload.
const managedCategorySchema = uploadCategorySchema;

async function isProjectDocumentManager() {
  const user = await getUser();
  return user != null && canManageProjectDocuments(user.profile?.role);
}

export async function getProjectFiles(projectId: string) {
  if (!projectIdSchema.safeParse(projectId).success) return [];
  if (!(await isProjectDocumentManager())) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_files")
    .select("*")
    .eq("project_id", projectId)
    .order("category")
    .order("created_at", { ascending: false });

  if (error) return [];
  return data ?? [];
}

export async function uploadProjectFile(
  projectId: string,
  formData: FormData
) {
  if (!projectIdSchema.safeParse(projectId).success) {
    return { error: "Invalid project" };
  }

  const appUser = await getUser();
  if (!appUser) return { error: "Not authenticated" };
  if (!canManageProjectDocuments(appUser.profile?.role)) {
    return { error: "Project files are limited to project managers and leadership" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const file = formData.get("file") as File;
  const categoryResult = uploadCategorySchema.safeParse(formData.get("category"));
  if (!categoryResult.success) return { error: "Invalid file category" };
  const category = categoryResult.data;
  const description = (formData.get("description") as string) || null;

  if (!file || file.size === 0) return { error: "No file provided" };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${projectId}/${category}/${Date.now()}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("project-files")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) return { error: uploadError.message };

  const { error: dbError } = await supabase.from("project_files").insert({
    project_id: projectId,
    filename: file.name,
    storage_path: path,
    storage_bucket: "project-files",
    mime_type: file.type,
    size: file.size,
    category,
    description,
    uploaded_by: user.id,
  });

  if (dbError) return { error: dbError.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function deleteProjectFile(fileId: string, projectId: string) {
  if (!z.string().uuid().safeParse(fileId).success || !projectIdSchema.safeParse(projectId).success) {
    return { error: "Invalid file" };
  }
  if (!(await isProjectDocumentManager())) {
    return { error: "Project files are limited to project managers and leadership" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Get the storage path + bucket before deleting.
  const { data: file } = await supabase
    .from("project_files")
    .select("storage_path, storage_bucket")
    .eq("id", fileId)
    .eq("project_id", projectId)
    .single();

  if (!file) return { error: "File not found" };

  // Only remove the underlying object when it's a genuine upload we own
  // (`project-files`). Rows that point into `email-attachments` are shared with
  // the email record — delete the project_files pointer but leave the email's
  // copy intact.
  if (file?.storage_path && file.storage_bucket !== "email-attachments") {
    await supabase.storage
      .from(file.storage_bucket ?? "project-files")
      .remove([file.storage_path]);
  }

  const { error } = await supabase
    .from("project_files")
    .delete()
    .eq("id", fileId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function updateProjectFileCategory(
  fileId: string,
  projectId: string,
  category: string,
) {
  const parsed = z.object({
    fileId: z.string().uuid(),
    projectId: z.string().uuid(),
    category: managedCategorySchema,
  }).safeParse({ fileId, projectId, category });
  if (!parsed.success) return { error: "Invalid file category" };
  if (!(await isProjectDocumentManager())) {
    return { error: "Project files are limited to project managers and leadership" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_files")
    .update({ category: parsed.data.category })
    .eq("id", parsed.data.fileId)
    .eq("project_id", parsed.data.projectId);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { success: true };
}

/**
 * "Remove from project" for an email-sourced attachment. Non-destructive: it
 * records a hide so the file stops showing on the Files tab, but the email and
 * its stored copy are untouched. `fileKey` is the stable identity the tab uses
 * (storage_path, or `${emailId}:${filename}` when there's no path).
 */
export async function dismissProjectFile(projectId: string, fileKey: string) {
  if (!projectIdSchema.safeParse(projectId).success || fileKey.length === 0 || fileKey.length > 1_000) {
    return { error: "Invalid file" };
  }
  if (!(await isProjectDocumentManager())) {
    return { error: "Project files are limited to project managers and leadership" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("project_dismissed_files")
    .upsert(
      { project_id: projectId, file_key: fileKey, dismissed_by: user.id },
      { onConflict: "project_id,file_key" },
    );
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

/** Undo a "remove from project" — bring a hidden email attachment back. */
export async function restoreProjectFile(projectId: string, fileKey: string) {
  if (!projectIdSchema.safeParse(projectId).success || fileKey.length === 0 || fileKey.length > 1_000) {
    return { error: "Invalid file" };
  }
  if (!(await isProjectDocumentManager())) {
    return { error: "Project files are limited to project managers and leadership" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("project_dismissed_files")
    .delete()
    .eq("project_id", projectId)
    .eq("file_key", fileKey);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

/** File keys the user has hidden from a project's Files tab. */
export async function getDismissedFileKeys(projectId: string): Promise<string[]> {
  if (!projectIdSchema.safeParse(projectId).success) return [];
  if (!(await isProjectDocumentManager())) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("project_dismissed_files")
    .select("file_key")
    .eq("project_id", projectId);
  return (data ?? []).map((r) => r.file_key as string);
}

const signedUrlRequestSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("uploaded"),
    projectId: z.string().uuid(),
    fileId: z.string().uuid(),
  }),
  z.object({
    source: z.literal("email"),
    projectId: z.string().uuid(),
    emailId: z.string().uuid(),
    storagePath: z.string().min(1).max(1_000),
  }),
]);

/**
 * Issues a short-lived URL only after proving that the requested object is
 * linked to this project. The browser never receives permission to choose an
 * arbitrary bucket/path pair.
 */
export async function getProjectFileSignedUrl(
  input: z.input<typeof signedUrlRequestSchema>,
): Promise<{ url?: string; error?: string }> {
  const parsed = signedUrlRequestSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid file request" };
  if (!(await isProjectDocumentManager())) {
    return { error: "Project files are limited to project managers and leadership" };
  }

  const supabase = await createClient();
  let bucket: "project-files" | "email-attachments";
  let storagePath: string;

  if (parsed.data.source === "uploaded") {
    const { data: file } = await supabase
      .from("project_files")
      .select("storage_path, storage_bucket")
      .eq("id", parsed.data.fileId)
      .eq("project_id", parsed.data.projectId)
      .maybeSingle();
    if (!file?.storage_path) return { error: "File not found" };
    bucket = file.storage_bucket === "email-attachments"
      ? "email-attachments"
      : "project-files";
    storagePath = file.storage_path;
  } else {
    const request = parsed.data;
    const { data: email } = await supabase
      .from("inbox_emails")
      .select("attachments")
      .eq("id", request.emailId)
      .eq("project_id", request.projectId)
      .maybeSingle();
    const attachments = Array.isArray(email?.attachments)
      ? email.attachments as { storage_path?: unknown }[]
      : [];
    const belongsToEmail = attachments.some(
      (attachment) => attachment.storage_path === request.storagePath,
    );
    if (!belongsToEmail) return { error: "File not found" };
    bucket = "email-attachments";
    storagePath = request.storagePath;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);
  if (error || !data?.signedUrl) return { error: "Unable to open file" };
  return { url: data.signedUrl };
}

export async function getProjectQuoteSignedUrl(
  projectId: string,
  quoteId: string,
  storagePath: string,
): Promise<{ url?: string; error?: string }> {
  const parsed = z.object({
    projectId: z.string().uuid(),
    quoteId: z.string().uuid(),
    storagePath: z.string().min(1).max(1_000),
  }).safeParse({ projectId, quoteId, storagePath });
  if (!parsed.success) return { error: "Invalid quote request" };
  if (!(await isProjectDocumentManager())) {
    return { error: "Quotes are limited to project managers and leadership" };
  }

  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("quote_requests")
    .select("attachment_storage_path, gmail_message_id")
    .eq("id", parsed.data.quoteId)
    .eq("project_id", parsed.data.projectId)
    .maybeSingle();
  if (!quote) return { error: "Quote not found" };

  let pathIsLinked = quote.attachment_storage_path === parsed.data.storagePath;
  if (!pathIsLinked && quote.gmail_message_id) {
    const { data: email } = await supabase
      .from("inbox_emails")
      .select("attachments")
      .eq("gmail_message_id", quote.gmail_message_id)
      .eq("project_id", parsed.data.projectId)
      .maybeSingle();
    const attachments = Array.isArray(email?.attachments)
      ? email.attachments as { storage_path?: unknown }[]
      : [];
    pathIsLinked = attachments.some(
      (attachment) => attachment.storage_path === parsed.data.storagePath,
    );
  }
  if (!pathIsLinked) return { error: "Quote file not found" };

  const { data, error } = await supabase.storage
    .from("email-attachments")
    .createSignedUrl(parsed.data.storagePath, 60 * 60);
  if (error || !data?.signedUrl) return { error: "Unable to open quote" };
  return { url: data.signedUrl };
}

export type CrewDoc = {
  id: string;
  filename: string;
  category: string;
  mime_type: string | null;
  url: string | null;
};

// Document categories a field worker should see on the job — plans, drawings,
// permits, specs. Office/financial categories (pricing, invoices, estimates)
// are intentionally excluded.
const CREW_DOC_CATEGORIES = ["construction_drawings", "plans", "permits", "specs", "other"];

/**
 * Field-relevant documents for a job, with short-lived signed URLs so the crew
 * can open drawings/permits straight from the crew app (private bucket).
 */
export async function getCrewJobDocuments(projectId: string): Promise<CrewDoc[]> {
  if (!projectIdSchema.safeParse(projectId).success) return [];
  const user = await getUser();
  if (!user) return [];
  if (user.profile?.role !== "field" && !canManageProjectDocuments(user.profile?.role)) {
    return [];
  }

  const supabase = await createClient();

  const { data } = await supabase
    .from("project_files")
    .select("id, filename, category, mime_type, storage_path, created_at")
    .eq("project_id", projectId)
    .in("category", CREW_DOC_CATEGORIES)
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) return [];

  const paths = data.map((f) => f.storage_path).filter((p): p is string => !!p);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage
      .from("project-files")
      .createSignedUrls(paths, 60 * 60);
    (urls ?? []).forEach((u) => {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    });
  }

  return data.map((f) => ({
    id: f.id,
    filename: f.filename,
    category: f.category,
    mime_type: f.mime_type,
    url: f.storage_path ? signed.get(f.storage_path) ?? null : null,
  }));
}
