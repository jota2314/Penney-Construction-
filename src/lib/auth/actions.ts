"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

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
 * Normal sign in — just pick your account, no re-granting permissions.
 * Uses consent prompt to ensure we always get a refresh token.
 */
export async function signInWithGoogle() {
  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      scopes: GOOGLE_SCOPES,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) throw new Error(error.message);
  if (data.url) redirect(data.url);
}

/**
 * Force reconnect — used when tokens are expired/missing.
 * Always requests consent to get a fresh refresh token.
 */
export async function reconnectGoogle() {
  const supabase = await createClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      scopes: GOOGLE_SCOPES,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) throw new Error(error.message);
  if (data.url) redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
