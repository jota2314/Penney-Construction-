import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fieldVisibleFiles } from "@/lib/crew/crew-visibility";

const PAGE_SIZE = 1000;
const MAX_ROWS = 50_000;
const FILE_BUCKETS = new Set(["project-files", "email-attachments"]);

type FileRow = {
  id: string;
  project_id: string;
  filename: string | null;
  category: string | null;
  size: number | null;
  mime_type: string | null;
  storage_path: string | null;
  storage_bucket: string | null;
  created_at: string | null;
};
type Override = { file_key: string; category: string | null; display_name: string | null; superseded_at: string | null };
type Page<T> = { data: T[] | null; error: unknown; count: number | null };

/** A partial dismissal or revision list could put a withdrawn drawing back on site. */
async function readAll<T>(query: (offset: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  while (rows.length < MAX_ROWS) {
    const { data, error, count } = await query(rows.length);
    if (error || !data || count == null || count > MAX_ROWS || (expected !== null && expected !== count)) break;
    expected = count;
    rows.push(...data);
    if (rows.length === count) return rows;
    if (!data.length || rows.length > count) break;
  }
  throw new Error("Could not verify the complete list of field documents.");
}

/** Reads one already-authorized job. Apply the audience's categories after the office moves and renames. */
export async function loadFieldProjectFiles(db: SupabaseClient, projectId: string) {
  const [rows, dismissed, overrides] = await Promise.all([
    readAll<FileRow>((offset) => db.from("project_files")
      .select("id, project_id, filename, category, mime_type, size, storage_path, storage_bucket, created_at", { count: "exact" })
      .eq("project_id", projectId).order("id").range(offset, offset + PAGE_SIZE - 1)),
    readAll<{ file_key: string }>((offset) => db.from("project_dismissed_files")
      .select("file_key", { count: "exact" }).eq("project_id", projectId).order("file_key").range(offset, offset + PAGE_SIZE - 1)),
    readAll<Override>((offset) => db.from("project_file_overrides")
      .select("file_key, category, display_name, superseded_at", { count: "exact" })
      .eq("project_id", projectId).order("file_key").range(offset, offset + PAGE_SIZE - 1)),
  ]);
  const atSite = rows.filter((f) => f.project_id === projectId);
  const originals = new Map(atSite.map((f) => [f.id, f.filename]));
  return fieldVisibleFiles(atSite, dismissed.map((r) => r.file_key), overrides).filter((f) =>
    FILE_BUCKETS.has(f.storage_bucket ?? "project-files") &&
    !!f.storage_path && f.storage_path.length <= 1000 && !/[\\\x00-\x1f]/.test(f.storage_path) &&
    !f.storage_path.startsWith("/") && !f.storage_path.split("/").some((part) => part === "." || part === ".."),
  ).map((f) => ({ ...f, original_filename: originals.get(f.id) ?? null }));
}
