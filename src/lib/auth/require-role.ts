import { redirect } from "next/navigation";
import { requireAuth } from "./require-auth";
import type { AuthUser, UserRole } from "@/types/auth";

export async function requireRole(
  allowedRoles: UserRole[]
): Promise<AuthUser> {
  const user = await requireAuth();

  if (!user.profile || !allowedRoles.includes(user.profile.role)) {
    redirect("/dashboard?error=unauthorized");
  }

  return user;
}
