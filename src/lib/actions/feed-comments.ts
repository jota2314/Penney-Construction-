"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push/send";
import { notifyTaggedProfiles } from "@/lib/notifications/tagged-mentions";

export type FeedCommentSource = "company_post" | "daily_log";

export type FeedComment = {
  id: string;
  sourceType: FeedCommentSource;
  sourceId: string;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  body: string;
  createdAt: string;
};

const commentTagSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["job", "worker", "subcontractor"]),
  label: z.string().trim().min(1).max(160),
  token: z.string().trim().regex(/^[A-Za-z0-9]+$/).max(80),
  profileId: z.string().uuid().nullable(),
});

export type FeedCommentTag = z.infer<typeof commentTagSchema>;

const addCommentSchema = z.object({
  sourceType: z.enum(["company_post", "daily_log"]),
  sourceId: z.string().uuid(),
  body: z.string().trim().min(1, "Write a comment first.").max(2000),
  tags: z.array(commentTagSchema).max(30).default([]),
});

export type AddFeedCommentResult =
  | { ok: true; comment: FeedComment }
  | { ok: false; error: string };

export async function addFeedComment(
  input: z.input<typeof addCommentSchema>,
): Promise<AddFeedCommentResult> {
  const parsed = addCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  }

  const user = await getUser();
  const authorId = user?.profile?.id ?? user?.id;
  if (!authorId) return { ok: false, error: "Sign in to comment." };

  const supabase = await createClient();

  // Validate mentioned profiles against real accounts before storing/notifying.
  const requestedProfileIds = Array.from(
    new Set(
      parsed.data.tags
        .map((tag) => tag.profileId)
        .filter((id): id is string => Boolean(id) && id !== authorId),
    ),
  );
  const { data: validProfiles } = requestedProfileIds.length
    ? await supabase.from("profiles").select("id").in("id", requestedProfileIds)
    : { data: [] as { id: string }[] };
  const mentionedProfileIds = (validProfiles ?? []).map((profile) => profile.id);
  const storedTags = parsed.data.tags.map(({ id, type, label, token }) => ({
    id,
    type,
    label,
    token,
  }));

  const { data, error } = await supabase
    .from("feed_comments")
    .insert({
      source_type: parsed.data.sourceType,
      source_id: parsed.data.sourceId,
      author_id: authorId,
      body: parsed.data.body,
      tagged_entities: storedTags,
      mentioned_profile_ids: mentionedProfileIds,
    })
    .select("id, created_at")
    .single();

  if (error || !data) {
    console.error("Failed to add feed comment", {
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId,
      error: error?.message,
    });
    return { ok: false, error: "Could not post the comment. Try again." };
  }

  const authorName =
    user?.profile?.full_name ?? user?.email?.split("@")[0] ?? "A teammate";

  // Tagged teammates get a mention notification (in-app + push + email).
  await notifyTaggedProfiles({
    actorId: authorId,
    actorName: authorName,
    recipientProfileIds: mentionedProfileIds,
    sourceType: "feed_comment",
    sourceId: data.id,
    title: `${authorName} tagged you in a comment`,
    body: parsed.data.body,
    url: "/command-center",
  }).catch(() => {});

  // The post's author gets a comment notification — unless they were already
  // tagged above, so nobody gets pinged twice for one comment.
  await notifyPostAuthor({
    sourceType: parsed.data.sourceType,
    sourceId: parsed.data.sourceId,
    commentId: data.id,
    commenterId: authorId,
    commenterName: authorName,
    body: parsed.data.body,
    skipProfileIds: mentionedProfileIds,
  }).catch(() => {});

  revalidatePath("/command-center");
  revalidatePath("/crew");

  return {
    ok: true,
    comment: {
      id: data.id,
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId,
      authorId,
      authorName,
      authorEmail: user?.email ?? null,
      body: parsed.data.body,
      createdAt: data.created_at,
    },
  };
}

export async function deleteFeedComment(
  commentId: string,
): Promise<{ ok?: true; error?: string }> {
  const user = await getUser();
  const userId = user?.profile?.id ?? user?.id;
  if (!userId) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("feed_comments")
    .delete()
    .eq("id", commentId)
    .eq("author_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/command-center");
  revalidatePath("/crew");
  return { ok: true };
}

/**
 * All comments for a batch of feed posts of one kind, oldest first — one
 * query for the whole feed page. Group by sourceId at the call site.
 */
export async function listFeedCommentsForSources(
  sourceType: FeedCommentSource,
  sourceIds: string[],
): Promise<FeedComment[]> {
  if (sourceIds.length === 0) return [];
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("feed_comments")
    .select(
      "id, source_type, source_id, author_id, body, created_at, author:profiles!author_id(full_name, email)",
    )
    .eq("source_type", sourceType)
    .in("source_id", sourceIds)
    .order("created_at", { ascending: true });

  return (rows ?? []).map((row) => {
    const author = Array.isArray(row.author) ? row.author[0] : row.author;
    return {
      id: row.id,
      sourceType: row.source_type as FeedCommentSource,
      sourceId: row.source_id,
      authorId: row.author_id,
      authorName: author?.full_name ?? null,
      authorEmail: author?.email ?? null,
      body: row.body,
      createdAt: row.created_at,
    };
  });
}

/**
 * Best-effort in-app + push notification to the post's author when someone
 * comments on their post. Uses source_type='feed_comment' with the comment id
 * so each new comment produces its own notification (the app_notifications
 * unique key would otherwise dedup per post).
 */
async function notifyPostAuthor(args: {
  sourceType: FeedCommentSource;
  sourceId: string;
  commentId: string;
  commenterId: string;
  commenterName: string;
  body: string;
  skipProfileIds?: string[];
}): Promise<void> {
  const admin = createAdminClient();

  const table = args.sourceType === "company_post" ? "company_feed_posts" : "daily_logs";
  const { data: post } = await admin
    .from(table)
    .select("author_id")
    .eq("id", args.sourceId)
    .maybeSingle();

  const recipientId = post?.author_id;
  if (!recipientId || recipientId === args.commenterId) return;
  if (args.skipProfileIds?.includes(recipientId)) return;

  const title = `${args.commenterName} commented on your ${
    args.sourceType === "company_post" ? "post" : "daily log"
  }`;

  const { error } = await admin.from("app_notifications").insert({
    recipient_profile_id: recipientId,
    actor_profile_id: args.commenterId,
    kind: "comment",
    title,
    body: args.body.slice(0, 500),
    url: "/command-center",
    source_type: "feed_comment",
    source_id: args.commentId,
  });
  if (error) {
    console.error("[feed-comments] Could not persist comment notification", {
      commentId: args.commentId,
      error: error.message,
    });
  }

  await sendPushToUser(admin, recipientId, {
    title,
    body: args.body.slice(0, 120),
    url: "/command-center",
    tag: `feed_comment-${args.commentId}`,
  }).catch(() => 0);
}
