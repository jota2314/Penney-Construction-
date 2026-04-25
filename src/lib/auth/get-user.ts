import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser, UserProfile } from "@/types/auth";
import { IMPERSONATION_ALLOWED_EMAIL } from "./impersonation";

const IMPERSONATION_COOKIE = "impersonate_profile_id";

export async function getUser(): Promise<AuthUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const realProfile = profile as UserProfile | null;

  // Impersonation is gated to a single allowed email.
  const cookieStore = await cookies();
  const impersonateId = cookieStore.get(IMPERSONATION_COOKIE)?.value;

  if (
    impersonateId &&
    realProfile?.email?.toLowerCase() === IMPERSONATION_ALLOWED_EMAIL
  ) {
    const { data: imp } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", impersonateId)
      .single();

    if (imp) {
      return {
        id: user.id,
        email: user.email ?? "",
        profile: imp as UserProfile,
        isImpersonating: true,
        realProfile,
      };
    }
  }

  return {
    id: user.id,
    email: user.email ?? "",
    profile: realProfile,
    isImpersonating: false,
    realProfile,
  };
}
