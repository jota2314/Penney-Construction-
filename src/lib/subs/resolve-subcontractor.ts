import type { SupabaseClient } from "@supabase/supabase-js";

// Fuzzy free-text vendor/sub name → subcontractors.id.
//
// quote_requests and invoices rows are routinely created from AI-extracted or
// hand-typed names ("Cosentino Plumbing & Heating Inc", "Cameron Electric 1052")
// while the sub portal, awarding, and per-sub rollups all scope by
// subcontractor_id. This resolver links at write time so those rows are born
// linked instead of needing per-sub backfills.
//
// It is deliberately conservative: it returns an id ONLY when exactly one
// directory entry matches. No match, or two candidates, resolves to null —
// a wrong link (someone else's invoices in a sub's portal) is far worse than
// no link.

export interface SubDirectoryEntry {
  id: string;
  company: string; // normalized company_name
  contact: string; // normalized contact_name
}

const BUSINESS_SUFFIXES = new Set([
  "llc", "inc", "corp", "corporation", "co", "company", "ltd", "llp", "pc",
]);

/**
 * Normalize a vendor/sub name for matching: lowercase, strip punctuation,
 * trailing check/invoice numbers ("Cameron Electric 1052", "ck #104"), and
 * trailing business suffixes (LLC, Inc, Co, ...).
 */
export function normalizeSubName(raw: string): string {
  let s = (raw || "").toLowerCase().trim();
  s = s.replace(/\s*(?:ck|chk|check|inv|invoice)?\s*#?\s*\d{2,}$/, "");
  s = s.replace(/[&+]/g, " and ");
  s = s.replace(/[^a-z0-9 ]/g, " ");
  const tokens = s.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && BUSINESS_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

export async function loadSubDirectory(supabase: SupabaseClient): Promise<SubDirectoryEntry[]> {
  const { data } = await supabase
    .from("subcontractors")
    .select("id, company_name, contact_name")
    .eq("is_active", true);
  return (data ?? []).map((s: { id: string; company_name: string | null; contact_name: string | null }) => ({
    id: s.id,
    company: normalizeSubName(s.company_name || ""),
    contact: normalizeSubName(s.contact_name || ""),
  }));
}

// Every token of `a` is (a prefix of) some token of `b` — so
// "cameron electric" matches "cameron electrical services".
function tokensSubsume(a: string[], b: string[]): boolean {
  return a.every((t) => b.some((u) => u === t || (t.length >= 4 && u.startsWith(t))));
}

function uniqueId(hits: SubDirectoryEntry[]): string | null {
  const ids = [...new Set(hits.map((h) => h.id))];
  return ids.length === 1 ? ids[0] : null;
}

/**
 * Match a free-text name against a loaded directory. Tiered:
 * exact company → exact contact → substring containment → token subsumption.
 * Each tier must produce exactly ONE distinct sub or we fall through / bail.
 */
export function matchSubId(directory: SubDirectoryEntry[], rawName: string): string | null {
  const q = normalizeSubName(rawName);
  if (q.length < 3) return null;

  let id = uniqueId(directory.filter((e) => e.company && e.company === q));
  if (id) return id;

  id = uniqueId(directory.filter((e) => e.contact && e.contact === q));
  if (id) return id;

  id = uniqueId(
    directory.filter(
      (e) =>
        e.company.length >= 5 && q.length >= 5 &&
        (e.company.includes(q) || q.includes(e.company)),
    ),
  );
  if (id) return id;

  const qTokens = q.split(" ");
  return uniqueId(
    directory.filter((e) => {
      if (!e.company) return false;
      const cTokens = e.company.split(" ");
      return tokensSubsume(qTokens, cTokens) || tokensSubsume(cTokens, qTokens);
    }),
  );
}

/**
 * One-shot resolve. Never throws — a resolver failure must never block the
 * quote/invoice insert it decorates. For loops, loadSubDirectory + matchSubId
 * avoids refetching the directory per row.
 */
export async function resolveSubcontractorId(
  supabase: SupabaseClient,
  rawName: string | null | undefined,
): Promise<string | null> {
  if (!rawName?.trim()) return null;
  try {
    return matchSubId(await loadSubDirectory(supabase), rawName);
  } catch {
    return null;
  }
}
