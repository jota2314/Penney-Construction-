import { redirect } from "next/navigation";
import { getUser } from "./get-user";
import type { AuthUser } from "@/types/auth";

export async function requireAuth(): Promise<AuthUser> {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}
