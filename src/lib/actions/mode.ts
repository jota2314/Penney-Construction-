"use server";

import { cookies } from "next/headers";
import type { AppMode } from "@/types/auth";
import { MODE_COOKIE, isValidMode } from "@/lib/mode";

export async function setMode(mode: AppMode) {
  if (!isValidMode(mode)) return;

  const cookieStore = await cookies();
  cookieStore.set(MODE_COOKIE, mode, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
  });
}
