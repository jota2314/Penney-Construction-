import type { MarketingAsset, MarketingItem } from "@/types/marketing";

export const kindLabels = { video: "Video", carousel: "Carousel", preview: "Preview", image: "Image" };
export const statusLabels = { draft: "Draft", ready: "Ready", posted: "Posted" };
export const selectClass = "h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function mediaAssets(item: MarketingItem): MarketingAsset[] {
  return item.assets.filter((asset) => asset.role === "media").sort((a, b) => a.sort_order - b.sort_order);
}

export function coverAsset(item: MarketingItem): MarketingAsset | undefined {
  return item.assets.find((asset) => asset.role === "cover" && asset.url) || mediaAssets(item).find((asset) => asset.url);
}

export function fileSize(size: number) {
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function displayDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function downloadUrl(asset: MarketingAsset) {
  if (!asset.url) return "";
  if (!/^https?:\/\//i.test(asset.url)) return asset.url;
  const url = new URL(asset.url);
  // Supabase uses this parameter for Content-Disposition across origins.
  url.searchParams.set("download", asset.filename);
  return url.toString();
}

export function mimeOf(file: File) {
  const type = file.type.toLowerCase();
  const aliases: Record<string, string> = { "application/x-zip-compressed": "application/zip", "video/x-m4v": "video/mp4", "image/jpg": "image/jpeg" };
  if (aliases[type]) return aliases[type];
  if (type && type !== "application/octet-stream") return type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", pdf: "application/pdf", zip: "application/zip", txt: "text/plain" } as Record<string, string>)[ext || ""] || "application/octet-stream";
}
