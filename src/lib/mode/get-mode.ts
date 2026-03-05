import { cookies } from "next/headers";
import type { AppMode } from "@/types/auth";
import { MODE_COOKIE, isValidMode } from "@/lib/mode";

export async function getMode(): Promise<AppMode> {
  const cookieStore = await cookies();
  const value = cookieStore.get(MODE_COOKIE)?.value;
  return isValidMode(value) ? value : "precon";
}
