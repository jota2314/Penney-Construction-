"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { notifyTaggedProfiles } from "@/lib/notifications/tagged-mentions";
import { createClient } from "@/lib/supabase/server";

const tagSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["job", "worker", "subcontractor"]),
  label: z.string().trim().min(1).max(160),
  token: z.string().trim().regex(/^[A-Za-z0-9]+$/).max(80),
  profileId: z.string().uuid().nullable(),
});

const createPostSchema = z
  .object({
    id: z.string().uuid(),
    body: z.string().trim().max(4000),
    projectId: z.string().uuid().nullable(),
    tags: z.array(tagSchema).max(30),
    photoStoragePaths: z.array(z.string().min(1).max(500)).max(10),
  })
  .refine(
    (value) => value.body.length > 0 || value.photoStoragePaths.length > 0,
    "Write something or add a photo.",
  );

export type CompanyFeedTag = z.infer<typeof tagSchema>;

export type CompanyFeedPost = {
  id: string;
  body: string;
  projectId: string | null;
  projectName: string | null;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  tags: CompanyFeedTag[];
  photoUrls: string[];
  createdAt: string;
};

export type CreateCompanyFeedPostResult =
  | { ok: true; postId: string }
  | { ok: false; error: string };

export async function createCompanyFeedPost(
  input: z.input<typeof createPostSchema>,
): Promise<CreateCompanyFeedPostResult> {
  const parsed = createPostSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid post.",
    };
  }

  const user = await getUser();
  const authorId = user?.id;
  if (!authorId) return { ok: false, error: "Sign in to post." };

  const expectedPhotoPrefix = `company-feed/${parsed.data.id}/`;
  if (
    parsed.data.photoStoragePaths.some(
      (path) => !path.startsWith(expectedPhotoPrefix),
    )
  ) {
    return { ok: false, error: "One or more photo paths are invalid." };
  }

  const supabase = await createClient();
  const requestedProfileIds = Array.from(
    new Set(
      parsed.data.tags
        .map((tag) => tag.profileId)
        .filter((id): id is string => Boolean(id) && id !== authorId),
    ),
  );

  const [{ data: project }, { data: validProfiles }] = await Promise.all([
    parsed.data.projectId
      ? supabase
          .from("projects")
          .select("id, name")
          .eq("id", parsed.data.projectId)
          .maybeSingle()
      : Promise.resolve({ data: null as { id: string; name: string } | null }),
    requestedProfileIds.length > 0
      ? supabase.from("profiles").select("id").in("id", requestedProfileIds)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  if (parsed.data.projectId && !project) {
    return { ok: false, error: "The tagged job could not be found." };
  }

  const validatedProfileIds = (validProfiles ?? []).map((profile) => profile.id);
  const storedTags = parsed.data.tags.map((tag) => ({
    id: tag.id,
    type: tag.type,
    label: tag.label,
    token: tag.token,
  }));
  const { error } = await supabase.from("company_feed_posts").insert({
    id: parsed.data.id,
    author_id: authorId,
    body: parsed.data.body,
    project_id: parsed.data.projectId,
    tagged_entities: storedTags,
    mentioned_profile_ids: validatedProfileIds,
    photo_storage_paths: parsed.data.photoStoragePaths,
  });

  if (error) {
    console.error("Failed to create company feed post", {
      postId: parsed.data.id,
      error: error.message,
    });
    return { ok: false, error: "Could not publish the post. Try again." };
  }

  const authorName =
    user.profile?.full_name ?? user.email?.split("@")[0] ?? "A teammate";
  await notifyTaggedProfiles({
    actorId: authorId,
    actorName: authorName,
    recipientProfileIds: validatedProfileIds,
    sourceType: "company_post",
    sourceId: parsed.data.id,
    title: `${authorName} tagged you`,
    body: parsed.data.body || "Shared a photo",
    url: "/command-center",
  });

  revalidatePath("/command-center");
  return { ok: true, postId: parsed.data.id };
}

export async function listRecentCompanyFeedPosts(
  limit = 20,
): Promise<CompanyFeedPost[]> {
  const supabase = await createClient();
  const safeLimit = Math.min(Math.max(Math.round(limit), 1), 50);
  const { data: rows, error } = await supabase
    .from("company_feed_posts")
    .select(
      "id, body, project_id, author_id, tagged_entities, photo_storage_paths, created_at, author:profiles!author_id(full_name, email), project:projects!project_id(name)",
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error || !rows) return [];

  const allPaths = rows.flatMap((row) => row.photo_storage_paths ?? []);
  const signedUrlByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("project-files")
      .createSignedUrls(allPaths, 60 * 60);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) {
        signedUrlByPath.set(entry.path, entry.signedUrl);
      }
    }
  }

  return rows.map((row) => {
    const author = Array.isArray(row.author) ? row.author[0] : row.author;
    const project = Array.isArray(row.project) ? row.project[0] : row.project;
    const parsedTags = z.array(tagSchema.omit({ profileId: true })).safeParse(
      row.tagged_entities,
    );
    const tags: CompanyFeedTag[] = parsedTags.success
      ? parsedTags.data.map((tag) => ({ ...tag, profileId: null }))
      : [];
    const photoPaths = Array.isArray(row.photo_storage_paths)
      ? row.photo_storage_paths.filter(
          (path: unknown): path is string => typeof path === "string",
        )
      : [];
    return {
      id: row.id,
      body: row.body,
      projectId: row.project_id,
      projectName: project?.name ?? null,
      authorId: row.author_id,
      authorName: author?.full_name ?? null,
      authorEmail: author?.email ?? null,
      tags,
      photoUrls: photoPaths
        .map((path) => signedUrlByPath.get(path))
        .filter((url): url is string => Boolean(url)),
      createdAt: row.created_at,
    };
  });
}
