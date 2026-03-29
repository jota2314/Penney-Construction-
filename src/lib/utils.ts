import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a number as USD currency.
 * @param decimals - "zero" for whole dollars, "two" for cents (default: "zero")
 */
export function formatCurrency(
  val: number | null,
  decimals: "zero" | "two" = "zero"
): string {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals === "two" ? 2 : 0,
    maximumFractionDigits: decimals === "two" ? 2 : 0,
  }).format(val);
}

/**
 * Format a date string for display.
 * @param format - "short" for "Mar 29", "long" for "March 29" (default: "short")
 */
export function formatDate(
  date: Date | string,
  format: "short" | "long" = "short"
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: format === "long" ? "long" : "short",
    day: "numeric",
  });
}

/**
 * Build a full address string from parts. Returns null if no address.
 */
export function buildAddress(
  address?: string | null,
  city?: string | null,
  state?: string | null,
  zip?: string | null
): string | null {
  if (!address) return null;
  return `${address}${city ? `, ${city}` : ""}${state ? `, ${state}` : ""}${zip ? ` ${zip}` : ""}`;
}

/**
 * Parse JSON from Claude responses, stripping markdown code fences.
 */
export function parseClaudeJSON<T = unknown>(content: string): T {
  const cleaned = content
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  return JSON.parse(cleaned);
}
