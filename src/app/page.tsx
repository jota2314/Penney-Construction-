import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Where signed-out visitors (and every crawler) land when they open "/".
// This host is the staff app and is login-only (Jorge, 2026-10-13); the public
// company site is www.penneyconstructioninc.com. Keep this on /login: the iOS
// app also loads this root, and the company site isn't in its allowed hosts.
const SIGNED_OUT_DESTINATION = "/login";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(SIGNED_OUT_DESTINATION);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  redirect(profile?.role === "field" ? "/crew" : "/command-center");
}
