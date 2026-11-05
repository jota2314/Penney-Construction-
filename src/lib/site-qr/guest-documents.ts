import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldVisibleFiles } from "@/lib/crew/crew-visibility";
import { isSiteOpen } from "@/lib/sub-portal/site-code";

const SITE_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;
const MAX_METADATA_ROWS = 50_000;
const SIGNED_DOCUMENT_SECONDS = 5 * 60;
const BUCKETS = new Set(["project-files", "email-attachments"]);
const DOC_CATEGORIES = new Set(["construction_drawings", "plans", "specs"]);
const IMAGE_EXT = /\.(?:jpe?g|png|webp|avif|gif|bmp|tiff?|heic|heif)$/i;
const IMAGE_MIME = /^image\/(?:jpeg|png|webp|avif|gif|bmp|tiff|heic|heif)$/i;
const PRICE_NAME = /[$€£¥₹]|\b(?:USD|CAD|AUD|GBP|EUR)\s*\d|\d\s*(?:USD|CAD|AUD|GBP|EUR)\b|\b\d{1,3}(?:,\d{3})+\.\d{2}\b/i;

export class GuestDocumentsError extends Error {
  constructor(message: string, public readonly status: 404 | 503 = 503) { super(message); }
}

export type GuestJobDocument = {
  id: string;
  filename: string;
  category: "construction_drawings" | "plans" | "specs";
};

export type GuestJobDocuments = {
  project: { name: string; number: string; town: string | null };
  drawings: GuestJobDocument[];
  specs: GuestJobDocument[];
};

type Project = { id: string; name: string; project_number: string; city: string | null; status: string; is_overhead: boolean | null };
type FileRow = {
  id: string; project_id: string; filename: string | null; category: string | null;
  size: number | null; mime_type: string | null; storage_path: string | null; storage_bucket: string | null;
};
type QueryResult<T> = { data: T[] | null; error: { message: string } | null; count: number | null };

/** Metadata must be complete: a truncated hide/revision list could expose a file. */
async function readAll<T>(query: (offset: number) => PromiseLike<QueryResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < MAX_METADATA_ROWS) {
    const page = await query(rows.length);
    if (page.error || !page.data || page.count === null) throw unavailable();
    rows.push(...page.data);
    if (rows.length >= page.count) return rows;
    if (!page.data.length) throw unavailable();
  }
  throw unavailable();
}

function unavailable() {
  return new GuestDocumentsError("Job documents couldn't load. Please try again.");
}

function missing() {
  return new GuestDocumentsError("This job document isn't available. Please scan the current job QR code.", 404);
}

/** Client selection/design bundles may contain prices; technical cut sheets stay. */
function isClientPackage(filename: string) {
  const words = filename.toLowerCase().replace(/[_.&+-]+/g, " ");
  return /\bdesign\s*(?:presentation|package)\b|\b(?:fixtures?|finish(?:es)?).*selections?\b|\bselections?\s*(?:sheet|package)\b/.test(words);
}

function safeDocumentName(name: string | null): name is string {
  return !!name?.trim() && !PRICE_NAME.test(name) && !isClientPackage(name);
}

function supportedFile(file: FileRow): boolean {
  const name = file.filename ?? "";
  const mime = file.mime_type?.split(";")[0].trim().toLowerCase();
  const generic = !mime || mime === "application/octet-stream";
  return /\.pdf$/i.test(name) ? generic || mime === "application/pdf" : IMAGE_EXT.test(name) && (generic || IMAGE_MIME.test(mime ?? ""));
}

async function loadEligible(code: string, admin: SupabaseClient) {
  const normalized = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!SITE_CODE.test(normalized)) throw missing();
  const { data, error } = await admin.from("projects")
    .select("id, name, project_number, city, status, is_overhead")
    .eq("site_code", normalized).maybeSingle();
  if (error) throw unavailable();
  const project = data as Project | null;
  if (!project || !isSiteOpen(project)) throw missing();

  // Do not prefilter categories: office overrides may move a drawing, and the
  // complete job list is needed to suppress superseded revisions on every open.
  const [rows, dismissed, overrides] = await Promise.all([
    readAll<FileRow>((offset) => admin.from("project_files")
      .select("id, project_id, filename, category, mime_type, size, storage_path, storage_bucket", { count: "exact" })
      .eq("project_id", project.id).order("id").range(offset, offset + PAGE_SIZE - 1)),
    readAll<{ file_key: string }>((offset) => admin.from("project_dismissed_files")
      .select("file_key", { count: "exact" }).eq("project_id", project.id).order("file_key").range(offset, offset + PAGE_SIZE - 1)),
    readAll<{ file_key: string; category: string | null; display_name: string | null }>((offset) => admin.from("project_file_overrides")
      .select("file_key, category, display_name", { count: "exact" }).eq("project_id", project.id).order("file_key").range(offset, offset + PAGE_SIZE - 1)),
  ]);
  const originals = new Map(rows.map((file) => [file.id, file]));
  const files = fieldVisibleFiles(rows, dismissed.map((row) => row.file_key), overrides).filter((file) => {
    const original = originals.get(file.id)!;
    return file.project_id === project.id && DOC_CATEGORIES.has(file.category ?? "") &&
      safeDocumentName(original.filename) && safeDocumentName(file.filename) &&
      supportedFile(original) && supportedFile(file) &&
      BUCKETS.has(file.storage_bucket ?? "project-files") &&
      !!file.storage_path && file.storage_path.length <= 1000 &&
      !/[\\\x00-\x1f]/.test(file.storage_path) &&
      !file.storage_path.startsWith("/") && !file.storage_path.split("/").some((part) => part === ".." || part === ".");
  });
  return { project, files };
}

/** A code grants this job's field documents, never the office file cabinet. */
export async function getGuestJobDocuments(code: string, admin: SupabaseClient = createAdminClient()): Promise<GuestJobDocuments> {
  try {
    const { project, files } = await loadEligible(code, admin);
    const metadata = files.map((file): GuestJobDocument => ({
      id: file.id, filename: file.filename!, category: file.category as GuestJobDocument["category"],
    }));
    return {
      project: { name: project.name, number: project.project_number, town: project.city },
      drawings: metadata.filter((file) => file.category !== "specs"),
      specs: metadata.filter((file) => file.category === "specs"),
    };
  } catch (error) {
    if (error instanceof GuestDocumentsError) throw error;
    throw unavailable();
  }
}

/** Recheck the current job/file/hide/revision scope before minting one URL. */
export async function getGuestJobDocumentUrl(code: string, fileId: string, admin: SupabaseClient = createAdminClient()): Promise<string> {
  if (typeof fileId !== "string" || !UUID.test(fileId)) throw missing();
  try {
    const { files } = await loadEligible(code, admin);
    const file = files.find((row) => row.id === fileId);
    if (!file) throw missing();
    // Do not use the shared photo URL cache: it may contain a seven-day token.
    const { data, error } = await admin.storage.from(file.storage_bucket ?? "project-files")
      .createSignedUrl(file.storage_path!, SIGNED_DOCUMENT_SECONDS);
    if (error || !data?.signedUrl || new URL(data.signedUrl).protocol !== "https:") throw unavailable();
    return data.signedUrl;
  } catch (error) {
    if (error instanceof GuestDocumentsError) throw error;
    throw unavailable();
  }
}
