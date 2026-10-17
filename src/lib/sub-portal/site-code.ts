import { randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isInternalJob } from "@/lib/crew/crew-visibility";
import { SUB_LIVE_STATUSES, isSubLiveStatus } from "@/lib/sub-portal/statuses";

/**
 * Job-site QR codes. Each job gets a short random `projects.site_code`; the
 * printed QR opens /sub/j/{code}, where a sub checks in (or signs in / signs
 * up) and lands on that job's composer. The code — never the project id — is
 * what goes on the sign, so it carries nothing guessable.
 */

// No 0/O, 1/I/L: a code someone reads off a smudged sign still works.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

/**
 * Always the www host: the sub portal cookie is set host-only, and the apex
 * domain 307s to www, so a QR pointing anywhere else signs the sub in on a
 * host the portal never reads.
 */
export const SITE_QR_BASE = "https://www.penneyconstruction.build/sub/j/";

/** Jobs a sub can check in to: the same live list as his portal (statuses.ts). */
export const SITE_OPEN_STATUSES: readonly string[] = SUB_LIVE_STATUSES;

/** The office line printed on every sign and shown on the check-in page. */
export const SITE_OFFICE_PHONE = "978-621-4387";

/**
 * Who may print signs and tick "Sign is up": the office roles (the same four
 * the v3 tables' RLS admits). Field logins are refused.
 */
export const SITE_SIGN_ROLES: readonly string[] = ["owner", "precon_manager", "project_manager", "office_admin"];

export function canManageSiteSigns(role: string | null | undefined): boolean {
  return !!role && SITE_SIGN_ROLES.includes(role);
}

export function siteUrl(code: string): string {
  return `${SITE_QR_BASE}${code}`;
}

/**
 * Where a check-in lands: his portal with the job open and the composer up
 * (W3a reads ?job= and &compose=1).
 */
export function subPortalJobPath(projectId: string, compose = false): string {
  return `/sub/portal?job=${encodeURIComponent(projectId)}${compose ? "&compose=1" : ""}`;
}

export function normalizeSiteCode(input: string): string {
  return (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

function newSiteCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export type SiteProject = {
  id: string;
  name: string;
  project_number: string;
  city: string | null;
  status: string;
  assigned_pm: string | null;
  is_overhead: boolean | null;
};

/**
 * A sub can check in here: a live job that isn't the office, shop or
 * warehouse (those never show in his portal, so a scan there would land on
 * nothing).
 */
export function isSiteOpen(p: Pick<SiteProject, "status" | "name" | "project_number" | "is_overhead">): boolean {
  return isSubLiveStatus(p.status) && !isInternalJob(p);
}

export async function findProjectBySiteCode(
  supabase: SupabaseClient,
  rawCode: string,
): Promise<SiteProject | null> {
  const code = normalizeSiteCode(rawCode);
  if (code.length < CODE_LENGTH) return null;
  const { data } = await supabase
    .from("projects")
    .select("id, name, project_number, city, status, assigned_pm, is_overhead")
    .eq("site_code", code)
    .maybeSingle();
  return (data as SiteProject | null) ?? null;
}

/**
 * The job's site code, minted the first time anyone opens its QR. Only fills
 * an empty column, so two people opening the QR at once both end up with the
 * same code; a unique-index collision just rolls a new one.
 *
 * The code comes back from the UPDATE itself, never from re-running the
 * first SELECT: Next memoizes identical GET fetches within one server
 * render, so a repeated read keeps returning the stale empty value.
 */
export async function ensureProjectSiteCode(
  admin: SupabaseClient,
  projectId: string,
): Promise<string> {
  const { data: current, error: readErr } = await admin
    .from("projects")
    .select("site_code")
    .eq("id", projectId)
    .single();
  if (readErr) throw new Error(readErr.message);
  if (current?.site_code) return current.site_code as string;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: written, error } = await admin
      .from("projects")
      .update({ site_code: newSiteCode() })
      .eq("id", projectId)
      .is("site_code", null)
      .select("site_code")
      .maybeSingle();
    if (written?.site_code) return written.site_code as string;
    // 23505 = another job already has this code; roll again.
    if (error?.code === "23505") continue;
    if (error) throw new Error(error.message);

    // Nothing updated: someone else opened this job's QR a moment earlier
    // and their code landed first. Read it back (a different query than the
    // one above, so it isn't served from the memoized first read).
    const { data: raced } = await admin
      .from("projects")
      .select("id, site_code")
      .eq("id", projectId)
      .single();
    if (raced?.site_code) return raced.site_code as string;
  }
  throw new Error("Couldn't make a site code for this job. Try again.");
}

/**
 * Codes for a list of jobs (the bulk print page): the ones already minted
 * pass through, the missing ones go through ensureProjectSiteCode a few at a
 * time. A job whose code can't be made is left out of the map, so one bad
 * row doesn't blank the whole print run.
 */
export async function ensureSiteCodes(
  admin: SupabaseClient,
  jobs: { id: string; site_code: string | null }[],
): Promise<Map<string, string>> {
  const codes = new Map<string, string>();
  const missing: string[] = [];
  for (const job of jobs) {
    if (job.site_code) codes.set(job.id, job.site_code);
    else missing.push(job.id);
  }
  const BATCH = 6;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((id) => ensureProjectSiteCode(admin, id)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") codes.set(batch[j], r.value);
      else console.error("[site-code] couldn't mint a code", batch[j], r.reason);
    });
  }
  return codes;
}

/** app_settings key for the 60-second "how to" video (blank = hide "Watch how"). */
export const SUB_PORTAL_LOOM_SETTING = "sub_portal_loom_url";

/** The Loom link when one is set and is a real http(s) URL; otherwise null. */
export async function getSubPortalLoomUrl(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SUB_PORTAL_LOOM_SETTING)
    .maybeSingle();
  const value = String((data as { value?: string | null } | null)?.value ?? "").trim();
  return /^https?:\/\/\S+$/i.test(value) ? value : null;
}

// ─────────────────────────────── Company names

// Endings that don't make a different company: "MGL Tile" = "MGL Tile Inc".
const COMPANY_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "co",
  "corp",
  "corporation",
  "company",
  "ltd",
  "limited",
  "lp",
  "llp",
  "pc",
  "pllc",
]);

/**
 * A company name reduced to what tells companies apart, for matching what a
 * worker types on the sign-up form against the directory:
 * "MGL Tile, Inc." → "mgl tile"; "Cosentino Plumbing & Heating" →
 * "cosentino plumbing and heating". Case, accents, punctuation, a leading
 * "the" and trailing Inc/LLC/Co are ignored.
 */
export function normalizeCompanyName(input: string | null | undefined): string {
  const flat = (input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  let words = flat.split(" ").filter(Boolean);
  if (words.length > 1 && words[0] === "the") words = words.slice(1);
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** "Marcio Lima" → "Marcio"; blank → null. */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first || null;
}
