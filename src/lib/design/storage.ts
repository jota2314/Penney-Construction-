/**
 * Storage helpers for the design studio.
 *
 * Everything lives under `bathroom-designs/` in the existing `project-files`
 * bucket, which is private. Nothing here is ever made public: a design is a
 * private sandbox and its images must stay behind signed URLs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoomSpec, DesignMaterial } from "@/types/design";

export const DESIGN_BUCKET = "project-files";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // one working session

export function designRefPath(designId: string, index: number, ext: string) {
  return `bathroom-designs/${designId}/refs/${Date.now()}_${index}.${ext}`;
}

export function designSwatchPath(designId: string, materialId: string, ext: string) {
  return `bathroom-designs/${designId}/materials/${materialId}_${Date.now()}.${ext}`;
}

export function designRenderPath(designId: string, version: number) {
  return `bathroom-designs/${designId}/renders/v${version}_${Date.now()}.png`;
}

export function designViewportPath(designId: string, version: number) {
  return `bathroom-designs/${designId}/viewports/v${version}_${Date.now()}.png`;
}

/** Uploads a base64 payload. Returns the storage path, or null on failure. */
export async function uploadBase64(
  supabase: SupabaseClient,
  path: string,
  base64: string,
  contentType: string,
): Promise<string | null> {
  const buffer = Buffer.from(base64, "base64");
  const { error } = await supabase.storage
    .from(DESIGN_BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  return error ? null : path;
}

/**
 * Signs a storage path.
 *
 * Any resize is baked in HERE, at signing time. Appending transform params to
 * an already-signed URL silently returns the untransformed original, so the
 * options have to be part of the signature.
 */
export async function signPath(
  supabase: SupabaseClient,
  path: string | null | undefined,
  transform?: { width: number; height: number },
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(DESIGN_BUCKET)
    .createSignedUrl(
      path,
      SIGNED_URL_TTL_SECONDS,
      transform ? { transform: { ...transform, resize: "contain" } } : undefined,
    );
  return error ? null : (data?.signedUrl ?? null);
}

/**
 * Resolves signed URLs for every material swatch in a spec.
 *
 * The viewer builds its tile textures from these, so they have to be present
 * before the spec reaches the client. Swatches are capped at 512px — they are
 * tiled across a wall, so more resolution buys nothing and costs load time.
 */
export async function signSpecMaterials(
  supabase: SupabaseClient,
  spec: RoomSpec,
): Promise<RoomSpec> {
  const materials: DesignMaterial[] = await Promise.all(
    spec.materials.map(async (m) => ({
      ...m,
      textureUrl: await signPath(supabase, m.texturePath, { width: 512, height: 512 }),
      sourcePhotoUrl: await signPath(supabase, m.sourcePhotoPath, { width: 512, height: 512 }),
    })),
  );
  return { ...spec, materials };
}

/**
 * Strips signed URLs before persisting.
 *
 * Signed URLs expire within the hour. Writing one into the stored spec would
 * bake a dead link into the design and, worse, into every version snapshot taken
 * afterwards. Only the storage PATHS are durable.
 */
export function stripSignedUrls(spec: RoomSpec): RoomSpec {
  return {
    ...spec,
    materials: spec.materials.map((m) => {
      const rest: DesignMaterial = { ...m };
      delete rest.textureUrl;
      delete rest.sourcePhotoUrl;
      return rest;
    }),
  };
}

export function mediaTypeToExt(mediaType: string): string {
  const ext = mediaType.split("/")[1] ?? "png";
  return ext === "jpeg" ? "jpg" : ext;
}
