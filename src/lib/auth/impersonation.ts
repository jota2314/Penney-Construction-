"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  IMPERSONATION_ALLOWED_EMAIL,
  IMPERSONATION_COOKIE_NAME,
} from "./impersonation-config";

export async function startImpersonating(profileId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: realProfile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();

  if (realProfile?.email?.toLowerCase() !== IMPERSONATION_ALLOWED_EMAIL) {
    return { error: "Only Jorge can use View-as" };
  }

  const { data: target } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", profileId)
    .single();
  if (!target) return { error: "Target profile not found" };

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE_NAME, profileId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  revalidatePath("/", "layout");
  return { success: true };
}

export async function stopImpersonating() {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE_NAME);
  revalidatePath("/", "layout");
  return { success: true };
}
