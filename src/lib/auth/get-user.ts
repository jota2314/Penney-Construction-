import { cookies } from "next/headers";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser, UserProfile } from "@/types/auth";
import {
  IMPERSONATION_ALLOWED_EMAIL,
  IMPERSONATION_COOKIE_NAME,
} from "./impersonation-config";

export const getUser = cache(async function getUser(): Promise<AuthUser | null> {
  const supabase = await createClient();

  // Local ES256 verification against the cached JWKS — no network hop to
  // /auth/v1/user. The middleware has already refreshed the session cookie
  // by the time a render reaches here.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) return null;
  const userEmail = typeof claims?.email === "string" ? claims.email : "";

  // Impersonation is gated to a single allowed email. Fetch the impersonated
  // profile alongside the real one — the result is only honored below if the
  // real profile actually passes that gate.
  const cookieStore = await cookies();
  const impersonateId = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value;

  const [profileRes, impersonatedRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    impersonateId
      ? supabase.from("profiles").select("*").eq("id", impersonateId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const realProfile = profileRes.data as UserProfile | null;

  if (
    impersonateId &&
    realProfile?.email?.toLowerCase() === IMPERSONATION_ALLOWED_EMAIL
  ) {
    const imp = impersonatedRes.data as UserProfile | null;

    if (imp) {
      return {
        id: userId,
        email: userEmail,
        profile: imp,
        isImpersonating: true,
        realProfile,
      };
    }
  }

  return {
    id: userId,
    email: userEmail,
    profile: realProfile,
    isImpersonating: false,
    realProfile,
  };
});
