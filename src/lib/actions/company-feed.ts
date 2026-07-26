"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { canManageFeed } from "@/lib/auth/feed-permissions";
import { notifyTaggedProfiles } from "@/lib/notifications/tagged-mentions";
import {
  isGroupMentionType,
  profileInGroup,
  type GroupMentionType,
} from "@/lib/activity-mentions/groups";
import { signThumbUrls } from "@/lib/image/transform-signed-url";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listFeedCommentsForSources,
  type FeedComment,
} from "@/lib/actions/feed-comments";

const tagSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "job",
    "worker",
    "subcontractor",
    "everyone",
    "office",
    "field",
  ]),
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
  /** Resized (width=800) variants of photoUrls, same order — use for feed
   * tiles; keep photoUrls for the full-screen viewer. */
  photoThumbUrls: string[];
  createdAt: string;
  comments: FeedComment[];
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
  // Group tags (@Everyone / @Office / @Field) are deliberate broadcasts —
  // expand them to the matching profiles (by role) instead of the
  // individually-tagged people. Individual @tags still count on top.
  const groupTypes = Array.from(
    new Set(parsed.data.tags.map((tag) => tag.type).filter(isGroupMentionType)),
  ) as GroupMentionType[];
  const wantsGroups = groupTypes.length > 0;
  const requestedProfileIds = Array.from(
    new Set(
      parsed.data.tags
        .map((tag) => tag.profileId)
        .filter((id): id is string => Boolean(id) && id !== authorId),
    ),
  );

  const [{ data: project }, { data: candidateProfiles }] = await Promise.all([
    parsed.data.projectId
      ? supabase
          .from("projects")
          .select("id, name")
          .eq("id", parsed.data.projectId)
          .maybeSingle()
      : Promise.resolve({ data: null as { id: string; name: string } | null }),
    wantsGroups
      ? supabase.from("profiles").select("id, role")
      : requestedProfileIds.length > 0
        ? supabase.from("profiles").select("id, role").in("id", requestedProfileIds)
        : Promise.resolve({ data: [] as { id: string; role: string | null }[] }),
  ]);

  if (parsed.data.projectId && !project) {
    return { ok: false, error: "The tagged job could not be found." };
  }

  const requestedSet = new Set(requestedProfileIds);
  const validatedProfileIds = (candidateProfiles ?? [])
    .filter((profile) =>
      wantsGroups
        ? groupTypes.some((group) => profileInGroup(group, profile.role)) ||
          requestedSet.has(profile.id)
        : true,
    )
    .map((profile) => profile.id)
    .filter((id) => id !== authorId);
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

  // Only the tagged teammates are notified (in-app + push + email). A post
  // with no tags notifies no one; @Everyone expands to the whole team above.
  const authorName =
    user.profile?.full_name ?? user.email?.split("@")[0] ?? "A teammate";
  await notifyTaggedProfiles({
    actorId: authorId,
    actorName: authorName,
    recipientProfileIds: validatedProfileIds,
    sourceType: "company_post",
    sourceId: parsed.data.id,
    title: wantsGroups
      ? `${authorName} posted an update`
      : `${authorName} tagged you`,
    body: parsed.data.body || "Shared a photo",
    url: `/command-center?post=${parsed.data.id}`,
  }).catch((err) => {
    console.error("Failed to send post notifications", {
      postId: parsed.data.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  revalidatePath("/command-center");
  return { ok: true, postId: parsed.data.id };
}

/**
 * Delete a company post (managers only — Jorge + Ryan). Removes its photos and
 * comment thread too so nothing is orphaned. Uses the admin client after an
 * explicit permission check, so it works regardless of table RLS.
 */
export async function deleteCompanyFeedPost(
  postId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.string().uuid().safeParse(postId);
  if (!parsed.success) return { ok: false, error: "Invalid post." };

  const user = await getUser();
  if (!canManageFeed(user?.email)) {
    return { ok: false, error: "You don't have permission to delete this." };
  }

  const admin = createAdminClient();

  const { data: post } = await admin
    .from("company_feed_posts")
    .select("photo_storage_paths")
    .eq("id", parsed.data)
    .maybeSingle();

  const photoPaths = Array.isArray(post?.photo_storage_paths)
    ? (post!.photo_storage_paths as unknown[]).filter(
        (p): p is string => typeof p === "string",
      )
    : [];
  if (photoPaths.length > 0) {
    await admin.storage.from("project-files").remove(photoPaths).catch(() => {});
  }

  await admin
    .from("feed_comments")
    .delete()
    .eq("source_type", "company_post")
    .eq("source_id", parsed.data);

  const { error } = await admin
    .from("company_feed_posts")
    .delete()
    .eq("id", parsed.data);

  if (error) {
    console.error("Failed to delete company feed post", {
      postId: parsed.data,
      error: error.message,
    });
    return { ok: false, error: "Could not delete the post. Try again." };
  }

  revalidatePath("/command-center");
  revalidatePath("/crew");
  return { ok: true };
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

  const commentsByPost = new Map<string, FeedComment[]>();
  const allComments = await listFeedCommentsForSources(
    "company_post",
    rows.map((row) => row.id),
  ).catch(() => [] as FeedComment[]);
  for (const comment of allComments) {
    const list = commentsByPost.get(comment.sourceId) ?? [];
    list.push(comment);
    commentsByPost.set(comment.sourceId, list);
  }

  const allPaths = rows.flatMap((row) => row.photo_storage_paths ?? []);
  const signedUrlByPath = new Map<string, string>();
  let thumbUrlByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    // 7-day expiry so revisits within the week hit the browser cache
    // instead of re-downloading every photo.
    const FEED_TTL = 60 * 60 * 24 * 7;
    const [{ data: signed }, thumbs] = await Promise.all([
      supabase.storage.from("project-files").createSignedUrls(allPaths, FEED_TTL),
      signThumbUrls(supabase, "project-files", allPaths, FEED_TTL),
    ]);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) {
        signedUrlByPath.set(entry.path, entry.signedUrl);
      }
    }
    thumbUrlByPath = thumbs;
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
    const photoUrls = photoPaths
      .map((path) => signedUrlByPath.get(path))
      .filter((url): url is string => Boolean(url));
    return {
      id: row.id,
      body: row.body,
      projectId: row.project_id,
      projectName: project?.name ?? null,
      authorId: row.author_id,
      authorName: author?.full_name ?? null,
      authorEmail: author?.email ?? null,
      tags,
      photoUrls,
      // Fall back to the full-size URL for any path whose thumbnail failed to
      // sign, so a photo never disappears just because the resize did.
      photoThumbUrls: photoPaths
        .map((path) => thumbUrlByPath.get(path) ?? signedUrlByPath.get(path))
        .filter((url): url is string => Boolean(url)),
      createdAt: row.created_at,
      comments: commentsByPost.get(row.id) ?? [],
    };
  });
}
