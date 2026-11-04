"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { LEGACY_SUB_PORTAL_COOKIE, SUB_PORTAL_COOKIE } from "@/lib/sub-portal/auth";

async function getOrigin() {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") || headersList.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

// drive.file alone only grants access to files the app itself created.
// We also need drive.readonly to fetch Drive files referenced inside
// emails (clients sending Google Doc plans, subs sharing Sheets quotes,
// etc.) — those are owned by the sender, not us. drive.readonly + drive.file
// together gives "read everything the user can read, write only what we made."
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/documents";

/**
 * Account access only. Office Google integrations are connected separately.
 */
export async function signInWithGoogle() {
  const supabase = await createClient();
  const origin = await getOrigin();
  const jar = await cookies();
  jar.set("google-connect-user", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/callback",
    maxAge: 0,
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error || !data.url) {
    return { error: "Google sign-in couldn't start. Please try again." };
  }
  redirect(data.url);
}

/**
 * Force reconnect — used when tokens are expired/missing.
 * Always requests consent to get a fresh refresh token.
 */
export async function reconnectGoogle() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const officeRoles = ["owner", "precon_manager", "project_manager", "office_admin"];
  if (profileError || !profile?.role || !officeRoles.includes(profile.role)) {
    throw new Error("Only office team members can connect Google Workspace tools.");
  }
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      scopes: GOOGLE_SCOPES,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
        ...(user.email ? { login_hint: user.email } : {}),
      },
    },
  });

  if (error || !data.url) throw new Error("Google connection couldn't start. Please try again.");
  const jar = await cookies();
  jar.set("google-connect-user", user.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/callback",
    maxAge: 600,
  });
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // A shared office PC must not stay signed in as a sub once the staff
  // session is gone (the sub-portal staff guard only bites while it exists).
  const jar = await cookies();
  jar.delete(SUB_PORTAL_COOKIE);
  jar.delete(LEGACY_SUB_PORTAL_COOKIE);
  jar.delete("google-access-token");
  jar.delete("google-refresh-token");
  jar.set("google-connect-user", "", { httpOnly: true, path: "/auth/callback", maxAge: 0 });
  redirect("/login");
}
