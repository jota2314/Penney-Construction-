"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { canViewDesignStudio } from "@/lib/auth/role-access";
import { defaultRoomSpec, type RoomSpec, type DesignMaterial } from "@/types/design";
import { signSpecMaterials, signPath, stripSignedUrls } from "@/lib/design/storage";
import { computeTakeoff, type DesignTakeoff } from "@/lib/design/takeoff";
import { sanitizeSpec } from "@/lib/design/geometry";

/**
 * Design studio data access.
 *
 * Every function re-checks the allowlist. RLS already enforces ownership at the
 * database, but a server action is a public HTTP endpoint — checking here means
 * an unauthorised call fails fast rather than returning an empty list that looks
 * like real data.
 *
 * The check is impersonation-aware (effective profile email, same as the CEO
 * dashboard), so a View-as session correctly loses access to the sandbox. The
 * DB is stricter still: `owner_id = auth.uid()` uses the REAL signed-in user, so
 * rows can only ever belong to Jorge's own accounts.
 */

async function requireOwner() {
  const user = await getUser();
  if (!user || !canViewDesignStudio(user.profile?.email ?? user.email)) {
    // Deliberately the same outcome as a route that doesn't exist.
    redirect("/command-center");
  }
  return user;
}

export interface DesignSummary {
  id: string;
  name: string;
  projectLabel: string | null;
  updatedAt: string;
  version: number;
  /** Most recent photoreal render, if any. */
  thumbnailUrl: string | null;
}

export async function listDesigns(): Promise<DesignSummary[]> {
  const user = await requireOwner();
  const supabase = await createClient();

  const { data } = await supabase
    .from("bathroom_designs")
    .select("id, name, project_label, updated_at, spec")
    .eq("owner_id", user.id)
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  if (!data?.length) return [];

  // Newest render per design, for the card thumbnails.
  const { data: renders } = await supabase
    .from("bathroom_design_versions")
    .select("design_id, render_path, version_number")
    .in("design_id", data.map((d) => d.id))
    .not("render_path", "is", null)
    .order("version_number", { ascending: false });

  const latestRender = new Map<string, string>();
  for (const r of renders ?? []) {
    if (!latestRender.has(r.design_id) && r.render_path) {
      latestRender.set(r.design_id, r.render_path);
    }
  }

  return Promise.all(
    data.map(async (d) => ({
      id: d.id,
      name: d.name,
      projectLabel: d.project_label,
      updatedAt: d.updated_at,
      version: ((d.spec as RoomSpec)?.version) ?? 1,
      thumbnailUrl: await signPath(supabase, latestRender.get(d.id), {
        width: 640,
        height: 420,
      }),
    })),
  );
}

export interface DesignDetail {
  id: string;
  name: string;
  projectLabel: string | null;
  spec: RoomSpec;
  takeoff: DesignTakeoff;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    imageUrls: string[];
    createdAt: string;
  }[];
  latestRenderUrl: string | null;
}

export async function getDesign(designId: string): Promise<DesignDetail | null> {
  const user = await requireOwner();
  const supabase = await createClient();

  const { data: design } = await supabase
    .from("bathroom_designs")
    .select("id, name, project_label, spec")
    .eq("id", designId)
    .eq("owner_id", user.id)
    .single();

  if (!design) return null;

  const spec: RoomSpec =
    design.spec && Object.keys(design.spec).length > 0
      ? (design.spec as RoomSpec)
      : defaultRoomSpec(design.name);

  const [{ data: messages }, { data: render }] = await Promise.all([
    supabase
      .from("bathroom_design_messages")
      .select("id, role, content, image_paths, created_at")
      .eq("design_id", designId)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("bathroom_design_versions")
      .select("render_path")
      .eq("design_id", designId)
      .not("render_path", "is", null)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    id: design.id,
    name: design.name,
    projectLabel: design.project_label,
    spec: await signSpecMaterials(supabase, spec),
    takeoff: computeTakeoff(spec),
    messages: await Promise.all(
      (messages ?? []).map(async (m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        imageUrls: (
          await Promise.all(
            (m.image_paths ?? []).map((p: string) =>
              signPath(supabase, p, { width: 480, height: 480 }),
            ),
          )
        ).filter((u): u is string => Boolean(u)),
        createdAt: m.created_at,
      })),
    ),
    latestRenderUrl: await signPath(supabase, render?.render_path),
  };
}

export async function createDesign(formData: FormData) {
  const user = await requireOwner();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim() || "Untitled bathroom";
  const projectLabel = String(formData.get("projectLabel") ?? "").trim() || null;

  const { data, error } = await supabase
    .from("bathroom_designs")
    .insert({
      owner_id: user.id,
      name,
      project_label: projectLabel,
      spec: stripSignedUrls(defaultRoomSpec(name)),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Couldn't create that design.");
  }

  revalidatePath("/design");
  redirect(`/design/${data.id}`);
}

export async function renameDesign(designId: string, name: string, projectLabel: string | null) {
  const user = await requireOwner();
  const supabase = await createClient();

  const { data: design } = await supabase
    .from("bathroom_designs")
    .select("spec")
    .eq("id", designId)
    .eq("owner_id", user.id)
    .single();

  // Keep the name inside the spec in step — the render prompt reads from it.
  const spec = design?.spec as RoomSpec | undefined;
  const nextSpec = spec ? { ...spec, name } : undefined;

  await supabase
    .from("bathroom_designs")
    .update({
      name,
      project_label: projectLabel,
      ...(nextSpec ? { spec: stripSignedUrls(nextSpec) } : {}),
    })
    .eq("id", designId)
    .eq("owner_id", user.id);

  revalidatePath("/design");
  revalidatePath(`/design/${designId}`);
}

export async function archiveDesign(designId: string) {
  const user = await requireOwner();
  const supabase = await createClient();

  await supabase
    .from("bathroom_designs")
    .update({ status: "archived" })
    .eq("id", designId)
    .eq("owner_id", user.id);

  revalidatePath("/design");
  redirect("/design");
}

/**
 * Rolls the design back to an earlier version.
 *
 * The old spec is written forward as a NEW version rather than deleting what
 * came after. Design is exploratory and a rollback is often itself a mistake;
 * nothing should be destroyed to undo something.
 */
export async function restoreVersion(designId: string, versionNumber: number) {
  const user = await requireOwner();
  const supabase = await createClient();

  const { data: target } = await supabase
    .from("bathroom_design_versions")
    .select("spec")
    .eq("design_id", designId)
    .eq("owner_id", user.id)
    .eq("version_number", versionNumber)
    .single();

  if (!target?.spec) throw new Error(`No version ${versionNumber} to restore.`);

  const { data: current } = await supabase
    .from("bathroom_designs")
    .select("spec")
    .eq("id", designId)
    .eq("owner_id", user.id)
    .single();

  const currentVersion = ((current?.spec as RoomSpec)?.version) ?? versionNumber;
  const restored: RoomSpec = { ...(target.spec as RoomSpec), version: currentVersion + 1 };

  await supabase
    .from("bathroom_designs")
    .update({ spec: stripSignedUrls(restored) })
    .eq("id", designId)
    .eq("owner_id", user.id);

  await supabase.from("bathroom_design_versions").insert({
    design_id: designId,
    owner_id: user.id,
    version_number: restored.version,
    spec: stripSignedUrls(restored),
    summary: `Restored version ${versionNumber}`,
  });

  revalidatePath(`/design/${designId}`);
}

export interface VersionSummary {
  versionNumber: number;
  summary: string | null;
  createdAt: string;
  renderUrl: string | null;
}

export async function listVersions(designId: string): Promise<VersionSummary[]> {
  const user = await requireOwner();
  const supabase = await createClient();

  const { data } = await supabase
    .from("bathroom_design_versions")
    .select("version_number, summary, created_at, render_path")
    .eq("design_id", designId)
    .eq("owner_id", user.id)
    .order("version_number", { ascending: false })
    .limit(50);

  return Promise.all(
    (data ?? []).map(async (v) => ({
      versionNumber: v.version_number,
      summary: v.summary,
      createdAt: v.created_at,
      renderUrl: await signPath(supabase, v.render_path, { width: 320, height: 210 }),
    })),
  );
}

/**
 * Saves a spec edited by hand in the plan editor.
 *
 * Debounced by the client, so one drag produces one call and one version rather
 * than a row per animation frame. Geometry is re-clamped here rather than
 * trusted from the browser: the spec is user input arriving over HTTP, and the
 * takeoff downstream reads it as fact.
 *
 * Version is bumped so a bad drag can be walked back through the same history
 * the AI turns write into — see restoreVersion.
 */
export async function saveDesignSpec(
  designId: string,
  spec: RoomSpec,
): Promise<{ version: number; takeoff: DesignTakeoff; adjusted: string[] }> {
  const user = await requireOwner();
  const supabase = await createClient();

  const { data: design } = await supabase
    .from("bathroom_designs")
    .select("spec")
    .eq("id", designId)
    .eq("owner_id", user.id)
    .single();

  if (!design) throw new Error("Design not found.");

  const current = design.spec as RoomSpec | null;
  const { spec: clean, adjusted } = sanitizeSpec(spec);

  const next: RoomSpec = {
    ...clean,
    // Trust the stored version, not the client's — two tabs open would
    // otherwise fight over the number.
    version: ((current?.version) ?? clean.version ?? 1) + 1,
  };

  await supabase
    .from("bathroom_designs")
    .update({ spec: stripSignedUrls(next), name: next.name })
    .eq("id", designId)
    .eq("owner_id", user.id);

  await supabase.from("bathroom_design_versions").insert({
    design_id: designId,
    owner_id: user.id,
    version_number: next.version,
    spec: stripSignedUrls(next),
    summary: "Edited in the plan",
  });

  return { version: next.version, takeoff: computeTakeoff(next), adjusted };
}

// ── Material library ─────────────────────────────────────────────────────────

/**
 * Materials saved for reuse across designs.
 *
 * The point is that a tile only has to be photographed once. Shoot the sample
 * at the supplier, save it, and it's available in every future bathroom without
 * hunting for the old design it came from.
 *
 * Stored in `design_materials`, which is scoped to the owner by the same RLS as
 * everything else in the studio.
 */
export interface LibraryMaterialRow {
  libraryId: string;
  id: string;
  name: string;
  kind: DesignMaterial["kind"];
  tileWidthIn: number | null;
  tileHeightIn: number | null;
  groutWidthIn: number;
  groutColor: string;
  pattern: DesignMaterial["pattern"];
  baseColor: string;
  roughness: number;
  metalness: number;
  finish: DesignMaterial["finish"];
  sourcePhotoPath: string | null;
  texturePath: string | null;
  textureUrl: string | null;
}

export async function listLibraryMaterials(): Promise<LibraryMaterialRow[]> {
  const user = await requireOwner();
  const supabase = await createClient();

  const { data } = await supabase
    .from("design_materials")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(60);

  return Promise.all(
    (data ?? []).map(async (r) => ({
      libraryId: r.id,
      // A stable slug so re-adding the same library tile to a design doesn't
      // collide with an unrelated material that happens to share an id.
      id: `mat-lib-${r.id.slice(0, 8)}`,
      name: r.name,
      kind: r.kind,
      tileWidthIn: r.tile_width_in,
      tileHeightIn: r.tile_height_in,
      groutWidthIn: Number(r.grout_width_in),
      groutColor: r.grout_color,
      pattern: r.pattern,
      baseColor: r.base_color,
      roughness: Number(r.roughness),
      metalness: Number(r.metalness),
      finish: r.finish,
      sourcePhotoPath: r.source_photo_path,
      texturePath: r.texture_path,
      textureUrl: await signPath(supabase, r.texture_path, { width: 512, height: 512 }),
    })),
  );
}

/**
 * Saves a palette material to the library.
 *
 * Keyed on the name so re-saving a tweaked version updates it rather than
 * filling the library with near-duplicates of the same product.
 */
export async function saveMaterialToLibrary(material: DesignMaterial): Promise<void> {
  const user = await requireOwner();
  const supabase = await createClient();

  const row = {
    owner_id: user.id,
    name: material.name,
    kind: material.kind,
    tile_width_in: material.tileWidthIn ?? null,
    tile_height_in: material.tileHeightIn ?? null,
    grout_width_in: material.groutWidthIn ?? 0.125,
    grout_color: material.groutColor ?? "#cfcabf",
    pattern: material.pattern ?? "stack",
    base_color: material.baseColor,
    roughness: material.roughness ?? 0.6,
    metalness: material.metalness ?? 0,
    finish: material.finish ?? null,
    source_photo_path: material.sourcePhotoPath ?? null,
    texture_path: material.texturePath ?? null,
  };

  const { data: existing } = await supabase
    .from("design_materials")
    .select("id")
    .eq("owner_id", user.id)
    .eq("name", material.name)
    .maybeSingle();

  if (existing) {
    await supabase.from("design_materials").update(row).eq("id", existing.id);
  } else {
    await supabase.from("design_materials").insert(row);
  }
}

export async function deleteLibraryMaterial(libraryId: string): Promise<void> {
  const user = await requireOwner();
  const supabase = await createClient();
  await supabase
    .from("design_materials")
    .delete()
    .eq("id", libraryId)
    .eq("owner_id", user.id);
}
