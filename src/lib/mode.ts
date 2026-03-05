import type { AppMode } from "@/types/auth";

export const MODE_COOKIE = "pc-mode";

export function isValidMode(value: unknown): value is AppMode {
  return value === "precon" || value === "construction";
}
