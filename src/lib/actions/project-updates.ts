"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { sendPushToUser } from "@/lib/push/send";
import { createClient } from "@/lib/supabase/server";

const projectUpdateSchema = z.object({
  projectId: z.string().uuid(),
  body: z.string().trim().min(1, "Write an update first.").max(2000),
  mentionedProfileIds: z.array(z.string().uuid()).max(20),
});

export type PostProjectUpdateResult =
  | { ok: true; updateId: string }
  | { ok: false; error: string };

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
  await Promise.allSettled(
    validatedMentionIds.map((profileId) =>
      sendPushToUser(supabase, profileId, {
        title: `${authorName} tagged you`,
        body: `${project.name}: ${parsed.data.body.slice(0, 120)}`,
        url: `/projects/${parsed.data.projectId}`,
        tag: `project-update-${update.id}`,
      }),
    ),
  );

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true, updateId: update.id };
}
