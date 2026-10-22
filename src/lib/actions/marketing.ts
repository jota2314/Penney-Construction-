"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMarketingUser } from "@/lib/marketing/auth";
import {
  MARKETING_BUCKET, MARKETING_UPLOAD_CHUNK_BYTES, marketingItemSchema,
  marketingUploadSchema, marketingObjectPath, marketingUploadEndpoint, storageMetadataMatches,
} from "@/lib/marketing/validation";
import type {
  MarketingAsset, MarketingItem, MarketingItemInput, MarketingMutationResult,
  MarketingProject, MarketingUploadInput, MarketingUploadReservation,
} from "@/types/marketing";

const SIGNED_URL_TTL = 60 * 60 * 12;
const ASSET_COLUMNS = "id,item_id,filename,mime_type,size,storage_bucket,storage_path,sort_order,role,created_at";
const ITEM_COLUMNS = "id,title,description,caption,kind,status,project_id,instagram_url,posted_at,created_at,updated_at,archived_at";
type Db = Awaited<ReturnType<typeof createClient>>;
type AssetRow = Omit<MarketingAsset, "url">;

function message(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Check the item details.";
  return error instanceof Error ? error.message : "Couldn't save this change. Please try again.";
}

async function assertActiveItem(db: Db, id: string) {
  z.uuid().parse(id);
  const { data, error } = await db.from("marketing_items").select("id")
    .eq("id", id).is("archived_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This marketing item is no longer available.");
}

async function signedAssets(db: Db, assets: AssetRow[]): Promise<MarketingAsset[]> {
  if (!assets.length) return [];
  const byPath = new Map<string, string>();
  // Keep each storage request bounded while still loading the whole library.
  for (let offset = 0; offset < assets.length; offset += 100) {
    const { data, error } = await db.storage.from(MARKETING_BUCKET)
      .createSignedUrls(assets.slice(offset, offset + 100).map(asset => asset.storage_path), SIGNED_URL_TTL);
    if (error) throw new Error("Couldn't load the media previews. Please refresh.");
    for (const link of data ?? []) if (link.path && link.signedUrl) byPath.set(link.path, link.signedUrl);
  }
  return assets.map(asset => ({ ...asset, size: Number(asset.size), url: byPath.get(asset.storage_path) ?? null }));
}

export async function getMarketingLibrary(): Promise<{ items: MarketingItem[]; projects: MarketingProject[]; error?: string }> {
  try {
    await requireMarketingUser();
    const db = await createClient();
    const rows: Omit<MarketingItem, "assets" | "project">[] = [];
    const projects: MarketingProject[] = [];
    for (let start = 0; ; start += 500) {
      const { data, error } = await db.from("marketing_items").select(ITEM_COLUMNS)
        .is("archived_at", null).order("updated_at", { ascending: false }).order("id").range(start, start + 499);
      if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205"
        ? "The marketing library is being set up. Please try again shortly." : error.message);
      rows.push(...(data ?? []) as typeof rows);
      if ((data?.length ?? 0) < 500) break;
    }
    for (let start = 0; ; start += 500) {
      const { data, error } = await db.from("projects").select("id,name,project_number")
        .order("name").order("id").range(start, start + 499);
      if (error) throw new Error(error.message);
      projects.push(...(data ?? []) as MarketingProject[]);
      if ((data?.length ?? 0) < 500) break;
    }
    const assetRows: AssetRow[] = [];
    for (let offset = 0; offset < rows.length; offset += 100) {
      for (let start = 0; ; start += 500) {
        const { data, error } = await db.from("marketing_assets").select(ASSET_COLUMNS)
          .in("item_id", rows.slice(offset, offset + 100).map(item => item.id))
          .eq("upload_status", "ready").is("archived_at", null)
          .order("sort_order").order("id").range(start, start + 499);
        if (error) throw new Error(error.message);
        assetRows.push(...(data ?? []) as AssetRow[]);
        if ((data?.length ?? 0) < 500) break;
      }
    }
    const assets = await signedAssets(db, assetRows);
    const projectMap = new Map(projects.map(project => [project.id, project]));
    return { items: rows.map(item => ({ ...item, assets: assets.filter(asset => asset.item_id === item.id),
      project: item.project_id ? projectMap.get(item.project_id) ?? null : null })), projects };
  } catch (error) { return { items: [], projects: [], error: message(error) }; }
}

export async function createMarketingItem(input: MarketingItemInput): Promise<{ id?: string; error?: string }> {
  try {
    const user = await requireMarketingUser(true);
    const fields = marketingItemSchema.parse(input);
    const db = await createClient();
    const { data, error } = await db.from("marketing_items").insert({ ...fields, created_by: user.id }).select("id").single();
    if (error) throw new Error(error.message);
    revalidatePath("/marketing");
    return { id: data.id };
  } catch (error) { return { error: message(error) }; }
}

export async function updateMarketingItem(id: string, input: MarketingItemInput): Promise<MarketingMutationResult> {
  try {
    await requireMarketingUser(true);
    const fields = marketingItemSchema.parse(input);
    const db = await createClient();
    await assertActiveItem(db, id);
    const { data, error } = await db.from("marketing_items").update(fields).eq("id", id).is("archived_at", null).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This item was archived while you were editing it.");
    revalidatePath("/marketing");
    return { success: true };
  } catch (error) { return { error: message(error) }; }
}

export async function archiveMarketingItem(id: string): Promise<MarketingMutationResult> {
  try {
    await requireMarketingUser(true);
    const db = await createClient();
    await assertActiveItem(db, id);
    const { error } = await db.from("marketing_items").update({ archived_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/marketing");
    return { success: true };
  } catch (error) { return { error: message(error) }; }
}

export async function reserveMarketingUpload(input: MarketingUploadInput): Promise<{ upload?: MarketingUploadReservation; error?: string }> {
  try {
    const user = await requireMarketingUser(true);
    const fields = marketingUploadSchema.parse(input);
    const db = await createClient();
    await assertActiveItem(db, fields.item_id);
    const id = randomUUID();
    const path = marketingObjectPath(fields.item_id, id, fields.filename);
    const { error: insertError } = await db.from("marketing_assets").insert({ ...fields, id,
      storage_bucket: MARKETING_BUCKET, storage_path: path, upload_status: "pending", created_by: user.id,
      upload_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
    if (insertError) throw new Error(insertError.message);
    const { data, error } = await db.storage.from(MARKETING_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "Couldn't start this upload.");
    return { upload: { asset_id: id, bucket: MARKETING_BUCKET, path, token: data.token,
      endpoint: marketingUploadEndpoint(process.env.NEXT_PUBLIC_SUPABASE_URL!), chunk_size: MARKETING_UPLOAD_CHUNK_BYTES } };
  } catch (error) { return { error: message(error) }; }
}

export async function finalizeMarketingUpload(assetId: string): Promise<{ asset?: MarketingAsset; error?: string }> {
  try {
    await requireMarketingUser(true);
    z.uuid().parse(assetId);
    const db = await createClient();
    const { data: row, error: rowError } = await db.from("marketing_assets")
      .select(`${ASSET_COLUMNS},upload_status`).eq("id", assetId).is("archived_at", null).maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row) throw new Error("The upload reservation is no longer available.");
    await assertActiveItem(db, row.item_id);
    const path = row.storage_path as string;
    const divider = path.lastIndexOf("/");
    const { data: files, error: fileError } = await db.storage.from(MARKETING_BUCKET)
      .list(path.slice(0, divider), { limit: 10, search: path.slice(divider + 1) });
    if (fileError) throw new Error(fileError.message);
    const file = files?.find(entry => entry.name === path.slice(divider + 1));
    if (!file || !storageMetadataMatches(row, file.metadata)) throw new Error("The upload hasn't finished or its file details don't match. Please retry.");
    if (row.upload_status !== "ready") {
      const { error } = await db.from("marketing_assets").update({ upload_status: "ready", upload_expires_at: null }).eq("id", assetId);
      if (error) throw new Error(error.message);
    }
    await db.from("marketing_items").update({ updated_at: new Date().toISOString() }).eq("id", row.item_id);
    revalidatePath("/marketing");
    return { asset: (await signedAssets(db, [row as AssetRow]))[0] };
  } catch (error) { return { error: message(error) }; }
}

export async function reorderMarketingAssets(itemId: string, assetIds: string[]): Promise<MarketingMutationResult> {
  try {
    await requireMarketingUser(true);
    z.uuid().parse(itemId);
    z.array(z.uuid()).max(1000).refine(ids => new Set(ids).size === ids.length, "Each file can appear only once.").parse(assetIds);
    const db = await createClient();
    const { error } = await db.rpc("reorder_marketing_assets", { p_item_id: itemId, p_asset_ids: assetIds });
    if (error) throw new Error(error.message);
    revalidatePath("/marketing");
    return { success: true };
  } catch (error) { return { error: message(error) }; }
}

export async function removeMarketingAsset(assetId: string): Promise<MarketingMutationResult> {
  try {
    await requireMarketingUser(true);
    z.uuid().parse(assetId);
    const db = await createClient();
    const { data: asset, error: lookupError } = await db.from("marketing_assets").select("item_id,archived_at").eq("id", assetId).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!asset) throw new Error("This file is no longer available.");
    // A successful response can be lost on a mobile connection. An authorized
    // retry of the same archival must succeed without touching the file again.
    if (asset.archived_at) {
      revalidatePath("/marketing");
      return { success: true };
    }
    await assertActiveItem(db, asset.item_id);
    const { error } = await db.from("marketing_assets").update({ archived_at: new Date().toISOString() }).eq("id", assetId);
    if (error) throw new Error(error.message);
    await db.from("marketing_items").update({ updated_at: new Date().toISOString() }).eq("id", asset.item_id);
    revalidatePath("/marketing");
    return { success: true };
  } catch (error) { return { error: message(error) }; }
}
