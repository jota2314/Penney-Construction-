"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  url: string;
  readAt: string | null;
  createdAt: string;
  actorName: string | null;
};

export async function listMyNotifications(limit = 20): Promise<{
  notifications: AppNotification[];
  unreadCount: number;
}> {
  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id;
  if (!profileId) return { notifications: [], unreadCount: 0 };

  const supabase = await createClient();
  const safeLimit = Math.min(Math.max(Math.round(limit), 1), 50);
  const [{ data: rows, error }, { count }] = await Promise.all([
    supabase
      .from("app_notifications")
      .select(
        "id, title, body, url, read_at, created_at, actor:profiles!actor_profile_id(full_name)",
      )
      .eq("recipient_profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(safeLimit),
    supabase
      .from("app_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_profile_id", profileId)
      .is("read_at", null),
  ]);

  if (error || !rows) return { notifications: [], unreadCount: count ?? 0 };

  return {
    notifications: rows.map((row) => {
      const actor = Array.isArray(row.actor) ? row.actor[0] : row.actor;
      return {
        id: row.id,
        title: row.title,
        body: row.body,
        url: row.url,
        readAt: row.read_at,
        createdAt: row.created_at,
        actorName: actor?.full_name ?? null,
      };
    }),
    unreadCount: count ?? 0,
  };
}

export async function markNotificationRead(
  notificationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.string().uuid().safeParse(notificationId);
  if (!parsed.success) return { ok: false, error: "Invalid notification." };

  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id;
  if (!profileId) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("recipient_profile_id", profileId);

  if (error) return { ok: false, error: "Could not update notification." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<{
  ok: true;
} | {
  ok: false;
  error: string;
}> {
  const user = await getUser();
  const profileId = user?.profile?.id ?? user?.id;
  if (!profileId) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_profile_id", profileId)
    .is("read_at", null);

  if (error) return { ok: false, error: "Could not update notifications." };
  revalidatePath("/", "layout");
  return { ok: true };
}
