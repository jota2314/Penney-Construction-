"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { notifyTaggedProfiles } from "@/lib/notifications/tagged-mentions";
import { createClient } from "@/lib/supabase/server";

const projectUpdateSchema = z.object({
  projectId: z.string().uuid(),
  body: z.string().trim().min(1, "Write an update first.").max(2000),
  mentionedProfileIds: z.array(z.string().uuid()).max(20),
});

export type PostProjectUpdateResult =
  | { ok: true; updateId: string }
  | { ok: false; error: string };

export async function deleteProjectUpdate(projectId: string, updateId: string) {
  const parsed = z.object({ projectId: z.string().uuid(), updateId: z.string().uuid() })
    .safeParse({ projectId, updateId });
  if (!parsed.success) return { ok: false as const, error: "Invalid project update." };
  const user = await getUser();
  if (!user) return { ok: false as const, error: "Sign in to delete an update." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_updates")
    .delete()
    .eq("id", parsed.data.updateId)
    .eq("project_id", parsed.data.projectId)
    .eq("author_id", user.id)
    .select("id");
  if (error) return { ok: false as const, error: "Could not delete the update. Try again." };
  if (!data?.length) return { ok: false as const, error: "Update not found or you don't have permission to delete it." };
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true as const };
}

export async function postProjectUpdate(
  projectId: string,
  body: string,
  mentionedProfileIds: string[],
): Promise<PostProjectUpdateResult> {
  const parsed = projectUpdateSchema.safeParse({
    projectId,
    body,
    mentionedProfileIds,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid project update.",
    };
  }

  const user = await getUser();
  const authorId = user?.id;
  if (!authorId) return { ok: false, error: "Sign in to post an update." };

  const supabase = await createClient();
  const uniqueMentionIds = Array.from(
    new Set(parsed.data.mentionedProfileIds),
  ).filter((id) => id !== authorId);

  const [{ data: project }, { data: validProfiles }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("id", parsed.data.projectId)
      .maybeSingle(),
    uniqueMentionIds.length > 0
      ? supabase
          .from("profiles")
          .select("id")
          .in("id", uniqueMentionIds)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  if (!project) return { ok: false, error: "Project not found." };

  const validatedMentionIds = (validProfiles ?? []).map((profile) => profile.id);
  const { data: update, error } = await supabase
    .from("project_updates")
    .insert({
      project_id: parsed.data.projectId,
      author_id: authorId,
      body: parsed.data.body,
      mentioned_profile_ids: validatedMentionIds,
    })
    .select("id")
    .single();

  if (error || !update) {
    console.error("Failed to post project update", {
      projectId: parsed.data.projectId,
      error: error?.message,
    });
    return { ok: false, error: "Could not post the update. Try again." };
  }

  const authorName =
    user?.profile?.full_name ?? user?.email?.split("@")[0] ?? "A teammate";
  await notifyTaggedProfiles({
    actorId: authorId,
    actorName: authorName,
    recipientProfileIds: validatedMentionIds,
    sourceType: "project_update",
    sourceId: update.id,
    title: `${authorName} tagged you`,
    body: `${project.name}: ${parsed.data.body}`,
    url: `/projects/${parsed.data.projectId}`,
  });

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true, updateId: update.id };
}
