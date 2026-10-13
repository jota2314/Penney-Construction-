import { randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Job-site QR codes. Each job gets a short random `projects.site_code`; the
 * printed QR opens /sub/j/{code}, where a sub signs in or signs up and lands
 * on that job's log. The code — never the project id — is what goes on the
 * sign, so it carries nothing guessable.
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

/** Jobs a sub can check in to — same whitelist as the portal's live job list. */
export const SITE_OPEN_STATUSES = ["in_progress", "contracted", "on_hold"];

export function siteUrl(code: string): string {
  return `${SITE_QR_BASE}${code}`;
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
};

export async function findProjectBySiteCode(
  supabase: SupabaseClient,
  rawCode: string,
): Promise<SiteProject | null> {
  const code = normalizeSiteCode(rawCode);
  if (code.length < CODE_LENGTH) return null;
  const { data } = await supabase
    .from("projects")
    .select("id, name, project_number, city, status, assigned_pm")
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
