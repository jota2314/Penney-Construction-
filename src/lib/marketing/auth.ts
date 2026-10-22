import { getUser } from "@/lib/auth/get-user";
import { canManageMarketing } from "@/lib/marketing/access";

/** Resolve the same effective identity as the rest of the app, including View as. */
export async function requireMarketingUser(write = false) {
  const user = await getUser();
  if (!user) throw new Error("Sign in to open Marketing.");
  if (!canManageMarketing(user.profile?.role)) throw new Error("Your account cannot access Marketing.");
  if (write && user.isImpersonating) throw new Error("Exit View as before changing the marketing library.");
  return user;
}
