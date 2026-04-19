import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata = {
  title: "Penney Construction — Residential General Contractor, North Shore MA",
  description:
    "Penney Construction builds kitchens, additions, and whole-home renovations for families on Boston's North Shore. Licensed, insured, and owner-led.",
};

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    redirect(profile?.role === "field" ? "/crew" : "/command-center");
  }

  return <LandingPage />;
}
