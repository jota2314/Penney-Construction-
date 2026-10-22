export type MarketingKind = "video" | "carousel" | "preview" | "image";
export type MarketingStatus = "draft" | "ready" | "posted";
export type MarketingAssetRole = "media" | "cover" | "download";

export interface MarketingProject {
  id: string;
  name: string;
  project_number: string;
}

export interface MarketingAsset {
  id: string;
  item_id: string;
  filename: string;
  mime_type: string;
  size: number;
  storage_bucket: string;
  storage_path: string;
  sort_order: number;
  role: MarketingAssetRole;
  created_at: string;
  url: string | null;
}

export interface MarketingItem {
  id: string;
  title: string;
  description: string;
  caption: string;
  kind: MarketingKind;
  status: MarketingStatus;
  project_id: string | null;
  instagram_url: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  assets: MarketingAsset[];
  project: MarketingProject | null;
}

export interface MarketingItemInput {
  title: string;
  description?: string;
  caption?: string;
  kind: MarketingKind;
  status: MarketingStatus;
  project_id?: string | null;
  instagram_url?: string | null;
  posted_at?: string | null;
}

export interface MarketingUploadInput {
  item_id: string;
  filename: string;
  mime_type: string;
  size: number;
  role: MarketingAssetRole;
  sort_order: number;
}

export interface MarketingUploadReservation {
  asset_id: string;
  bucket: string;
  path: string;
  token: string;
  endpoint: string;
  chunk_size: number;
}

export type MarketingMutationResult = { success?: true; error?: string };
