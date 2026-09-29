"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/get-user";
import { canEditGuides } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import {
  GUIDES_BUCKET,
  isGuideCategory,
  isGuideFilePath,
  type HowToGuide,
  type HowToGuideWithUrl,
} from "@/lib/guides/guides";

// Long enough that a page left open all day still opens its guides.
const URL_TTL_SECONDS = 60 * 60 * 12;

const FORBIDDEN = "Only Jorge and Ryan can change the How-To Guides";

const GUIDE_COLUMNS =
  "id, title, summary, category, author, file_path, file_name, file_size, sort_order, updated_at";

/** Every active guide with a signed PDF link, plus whether the viewer may edit. */
export async function getGuideLibrary(): Promise<{
  guides: HowToGuideWithUrl[];
  canEdit: boolean;
}> {
  const user = await getUser();
  if (!user) return { guides: [], canEdit: false };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("how_to_guides")
    .select(GUIDE_COLUMNS)
    .eq("is_archived", false)
    .order("sort_order")
    .order("title");
  if (error) console.error("getGuideLibrary:", error.message);

  const guides = (data ?? []) as HowToGuide[];
  const paths = guides.map((g) => g.file_path);
  const { data: signed } = paths.length
    ? await supabase.storage.from(GUIDES_BUCKET).createSignedUrls(paths, URL_TTL_SECONDS)
    : { data: [] };
  const urlByPath = new Map(
    (signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]),
  );

  return {
    guides: guides.map((g) => ({ ...g, url: urlByPath.get(g.file_path) ?? null })),
    canEdit: canEditGuides(user.profile?.email ?? user.email),
  };
}

export interface SaveGuideInput {
  /** Omit to add a new guide. */
  id?: string;
  title: string;
  summary: string;
  category: string;
  author: string;
  /** A PDF the browser already uploaded to the bucket. Required when adding. */
  file?: { path: string; name: string; size: number };
}

/**
 * Add a guide, or change one. The PDF upload itself happens in the browser
 * (gated by the bucket policies) so big guides never pass through a server
 * action; this only records it. A replaced PDF is left in the bucket so a
 * wrong upload can be undone.
 */
export async function saveGuide(input: SaveGuideInput): Promise<{ ok?: true; error?: string }> {
  const user = await getUser();
  if (!user) return { error: "Not signed in" };
  if (!canEditGuides(user.profile?.email ?? user.email)) return { error: FORBIDDEN };

  const title = input.title.trim();
  if (!title) return { error: "Give the guide a title" };
  if (!isGuideCategory(input.category)) return { error: "Pick a section" };
  if (!input.id && !input.file) return { error: "Choose the PDF" };
  if (input.file && !isGuideFilePath(input.file.path)) return { error: "That upload isn't a guide PDF" };

  const supabase = await createClient();
  const fields = {
    title,
    summary: input.summary.trim() || null,
    category: input.category,
    author: input.author.trim() || null,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
    ...(input.file
      ? { file_path: input.file.path, file_name: input.file.name, file_size: input.file.size }
      : {}),
  };

  if (input.id) {
    const { error } = await supabase.from("how_to_guides").update(fields).eq("id", input.id);
    if (error) return { error: error.message };
  } else {
    // New guides go to the end of their section.
    const { data: last } = await supabase
      .from("how_to_guides")
      .select("sort_order")
      .eq("category", input.category)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase
      .from("how_to_guides")
      .insert({ ...fields, created_by: user.id, sort_order: (last?.sort_order ?? 0) + 10 });
    if (error) return { error: error.message };
  }

  revalidatePath("/guides");
  return { ok: true };
}

/** Take a guide off the page. Archived, not deleted — the row and PDF stay. */
export async function removeGuide(id: string): Promise<{ ok?: true; error?: string }> {
  const user = await getUser();
  if (!user) return { error: "Not signed in" };
  if (!canEditGuides(user.profile?.email ?? user.email)) return { error: FORBIDDEN };

  const supabase = await createClient();
  const { error } = await supabase
    .from("how_to_guides")
    .update({ is_archived: true, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/guides");
  return { ok: true };
}
