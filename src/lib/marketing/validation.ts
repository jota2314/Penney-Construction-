import { z } from "zod";

export const MARKETING_BUCKET = "marketing-media";
export const MAX_MARKETING_FILE_BYTES = 500 * 1024 * 1024;
export const MARKETING_UPLOAD_CHUNK_BYTES = 6 * 1024 * 1024;

export const MARKETING_MIME_EXTENSIONS: Record<string, string[]> = {
  "video/mp4": ["mp4", "m4v"],
  "video/quicktime": ["mov"],
  "video/webm": ["webm"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/heic": ["heic"],
  "image/heif": ["heif"],
  "application/pdf": ["pdf"],
  "application/zip": ["zip"],
  "text/plain": ["txt"],
};

export function isInstagramUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(url.hostname)
      && !url.username && !url.password && !url.port
      && /^\/(p|reel|reels|tv)\/[^\s/?#]+\/?$/i.test(url.pathname);
  } catch { return false; }
}

const nullableText = z.string().trim().nullish().transform(value => value || null);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export const marketingItemSchema = z.object({
  title: z.string().trim().min(1, "Give this item a title.").max(160),
  description: z.string().trim().max(10000).optional().default(""),
  caption: z.string().trim().max(10000).optional().default(""),
  kind: z.enum(["video", "carousel", "preview", "image"]),
  status: z.enum(["draft", "ready", "posted"]),
  project_id: z.uuid().nullish().transform(value => value || null),
  instagram_url: nullableText.refine(value => !value || isInstagramUrl(value), "Use a full Instagram post or Reel link."),
  posted_at: nullableText.refine(value => !value || validDate(value), "Choose a valid posted date."),
}).refine(value => value.status !== "posted" || !!value.instagram_url, {
  path: ["instagram_url"], message: "Add the Instagram link before marking this item Posted.",
});

export const marketingUploadSchema = z.object({
  item_id: z.uuid(),
  filename: z.string().trim().min(1).max(240).refine(value => !/[\\/\u0000-\u001f]/.test(value), "Use a file name without folders."),
  mime_type: z.string().refine(value => value in MARKETING_MIME_EXTENSIONS, "Choose an image, video, PDF, ZIP, or text file."),
  size: z.number().int().positive().max(MAX_MARKETING_FILE_BYTES, "Files must be 500 MB or smaller."),
  role: z.enum(["media", "cover", "download"]),
  sort_order: z.number().int().min(0).max(10000),
}).superRefine((value, ctx) => {
  const extension = value.filename.split(".").pop()?.toLowerCase() ?? "";
  if (!MARKETING_MIME_EXTENSIONS[value.mime_type]?.includes(extension)) {
    ctx.addIssue({ code: "custom", path: ["filename"], message: "The file extension doesn't match its type." });
  }
  if (value.role === "cover" && !value.mime_type.startsWith("image/")) {
    ctx.addIssue({ code: "custom", path: ["role"], message: "A cover must be an image." });
  }
  if (value.role === "media" && !/^(image|video)\//.test(value.mime_type)) {
    ctx.addIssue({ code: "custom", path: ["role"], message: "Put documents and ZIP files in Downloads." });
  }
});

export function marketingObjectPath(itemId: string, assetId: string, filename: string): string {
  return `${itemId}/${assetId}/${filename.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^\.+/, "file-")}`;
}

export function storageMetadataMatches(expected: { size: number; mime_type: string }, metadata: Record<string, unknown> | null | undefined): boolean {
  return Number(metadata?.size) === expected.size && metadata?.mimetype === expected.mime_type;
}

export function marketingUploadEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith(".supabase.co")) url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  return `${url.origin}/storage/v1/upload/resumable`;
}
