import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Where signed-out visitors (and every crawler) land when they open "/".
// This host is the staff app, not the company website, so the old public
// landing page is gone. Switch this to "https://www.penneyconstructioninc.com"
// once the DNS swap puts the new company site live there.
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
