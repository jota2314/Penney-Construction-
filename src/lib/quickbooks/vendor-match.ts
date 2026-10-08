/**
 * Which QuickBooks vendor is this receipt from?
 *
 * Receipt scans spell the same store a dozen ways — "SULLIVAN TIRE #14",
 * "Sullivan Tire Peabody", "City of Peabody, MA", "Shell (Alliance Energy
 * LLC)". An exact DisplayName lookup missed every one of them and created a
 * new vendor each time (Nicole, 10/8 L10: "vendors are getting duplicated").
 * This picks the existing vendor instead, in order of confidence:
 *
 *   1. alias      — known nicknames (Howie → Howard Clickstein)
 *   2. exact      — same name once case, punctuation, "Inc/LLC/Corp", "The",
 *                   store numbers, a trailing "MA" and (parentheticals) are
 *                   ignored
 *   3. close      — one typo on a long name (Cosentino/Consentino); never
 *                   on short ones, where "Luis Santos" and "Luiz Santos" are
 *                   two different subs
 *   4. prefix     — the receipt adds words after a known vendor's full name
 *                   (Jackson Lumber → "Jackson Lumber & Millwork Co. Inc."),
 *                   only for known names specific enough to own the prefix —
 *                   "Ace Electric" must not land on a vendor called "Ace"
 *
 * Pure functions only — no QuickBooks calls — so it can be unit tested.
 */

export interface VendorCandidate {
  Id: string;
  DisplayName: string;
  Active?: boolean;
  MetaData?: { CreateTime?: string };
}

export type VendorMatch = {
  vendor: VendorCandidate;
  how: "alias" | "exact" | "close" | "prefix";
};

/** Nicknames and payroll names → the vendor name QuickBooks already uses. */
const NAME_ALIASES: Record<string, string> = {
  "howie clickstein": "howard clickstein",
  "moynihan north reading lumber": "moynihan lumber",
  "dl services": "d l services hvac",
  openai: "chatgpt",
  "openai chatgpt": "chatgpt",
  "susan e gallant cpa mst": "susan gallant cpa",
  "bjs wholesale club": "bjs",
  "bjs gas": "bjs",
  "shell oil": "shell",
  "lowes home centers": "lowes",
  "shell alliance energy": "shell",
};

const DROP_WORDS = new Set([
  "the", "inc", "incorporated", "llc", "corp", "corporation", "co", "company",
  "ltd", "of", "pbc", "lp", "llp", "pllc",
]);

/** "SULLIVAN TIRE #14" and "Sullivan Tire" both → "sullivan tire". */
export function normalizeVendorName(name: string): string {
  const words = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // scanned email bodies arrive HTML-escaped ("Demolition &amp; Removal")
    .replace(/&amp;/g, "&")
    // "(Vendor)" twins and "(Amazon Services LLC)" descriptors
    .replace(/\([^)]*\)/g, " ")
    .replace(/#\s*\d+/g, " ")
    .replace(/&/g, " and ")
    // apostrophes join (BJ's → bjs, Lowe's → lowes); other punctuation splits
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !DROP_WORDS.has(w));
  // "City of Peabody, MA" / "Citgo Danvers MA" — the state adds nothing.
  while (words.length > 1 && (words[words.length - 1] === "ma" || words[words.length - 1] === "massachusetts")) {
    words.pop();
  }
  return words.join(" ");
}

/** "Town Line" and "Townline", "T-Bone" and "TBone" compare equal. */
const squash = (normalized: string) => normalized.replace(/ /g, "");

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Several records can share one name already — keep using the oldest active one. */
function best(list: VendorCandidate[]): VendorCandidate | null {
  if (list.length === 0) return null;
  const rank = (v: VendorCandidate) => (v.Active === false ? 1 : 0);
  return [...list].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.MetaData?.CreateTime ?? "").localeCompare(b.MetaData?.CreateTime ?? "") ||
      Number(a.Id) - Number(b.Id),
  )[0];
}

export function matchVendor(name: string, vendors: VendorCandidate[]): VendorMatch | null {
  const wanted = normalizeVendorName(name);
  if (!wanted) return null;
  // QuickBooks renames a merged-away vendor "X (deleted)"; never post to it.
  const usable = vendors.filter((v) => !/\(deleted\)/i.test(v.DisplayName));
  const keyed = usable.map((v) => ({ v, n: normalizeVendorName(v.DisplayName) })).filter((x) => x.n);

  const alias = NAME_ALIASES[wanted];
  if (alias) {
    const hit = best(keyed.filter((x) => x.n === alias).map((x) => x.v));
    if (hit) return { vendor: hit, how: "alias" };
  }

  const exact = best(keyed.filter((x) => squash(x.n) === squash(wanted)).map((x) => x.v));
  if (exact) return { vendor: exact, how: "exact" };

  // Typos only on long names — on short ones a letter is a different
  // business or a different person.
  const w = squash(wanted);
  if (w.length >= 14) {
    const max = w.length >= 24 ? 2 : 1;
    const close = keyed
      .map((x) => ({ ...x, d: editDistance(w, squash(x.n), max) }))
      .filter((x) => x.d <= max);
    const top = Math.min(...close.map((x) => x.d));
    const hit = best(close.filter((x) => x.d === top).map((x) => x.v));
    if (hit) return { vendor: hit, how: "close" };
  }

  // The receipt name starts with a whole known vendor name. The longest known
  // name wins, so "Building Center of Essex" beats a generic "Building Center".
  // One short word ("Ace", "Joe", "Shell") is too generic to own a prefix.
  const specific = (n: string) => n.includes(" ") || n.length >= 6;
  const prefixed = keyed
    .filter((x) => specific(x.n) && wanted.startsWith(`${x.n} `))
    .sort((a, b) => b.n.length - a.n.length);
  if (prefixed.length > 0) {
    const longest = prefixed[0].n.length;
    const hit = best(prefixed.filter((x) => x.n.length === longest).map((x) => x.v));
    if (hit) return { vendor: hit, how: "prefix" };
  }

  return null;
}
