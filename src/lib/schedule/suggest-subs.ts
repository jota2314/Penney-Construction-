import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, todayET } from "@/lib/sub-portal/et-day";
import { SUB_AWARDED_QUOTE_STATUSES, isActiveProjectSub } from "@/lib/sub-portal/statuses";
import {
  isNonInstallerSub,
  normalizeTrade,
  subDoesTrade,
  textNamesTrade,
  tradeForPhaseName,
  tradeLabel,
} from "./trade-keywords";

/**
 * Who should be on this phase — suggested, never assigned.
 *
 * Deterministic and explainable: every chip says why it's there. Ranked
 *   1. the sub awarded the phase's budget line
 *   2. an accepted / approved quote on this job for this trade
 *   3. an active sub on this job who does this trade
 *   4. a STRICT mention in the phase name or notes: the full company name,
 *      the full contact name (first and last), or an alias the office saved
 *   5. billed this trade on this job in the last 90 days
 *   6. the top biller in this trade in the last 90 days
 *
 * A first name on its own is never a match. "Peter" in the notes is not
 * Master Floors and "Marcio" is not MGL Tile until the office says so by
 * saving the alias (the "Remember" button), and then only that exact word.
 * Material dealers and design/supply vendors never show (isNonInstallerSub).
 *
 * Pure apart from `loadSuggestContext`, which takes whatever client the
 * caller already has, so it runs in server actions and route handlers alike.
 */

type Db = Pick<SupabaseClient, "from">;

export interface SubDirectoryEntry {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  trades: string[] | null;
  aliases: string[] | null;
  email?: string | null;
  is_active?: boolean | null;
}

/** "MGL Tile Inc" → "MGL Tile Inc"; a nameless row falls back to the contact. */
export function subName(sub: Pick<SubDirectoryEntry, "company_name" | "contact_name">): string {
  return sub.company_name?.trim() || sub.contact_name?.trim() || "Unnamed sub";
}

// ── Strict text matching ────────────────────────────────────────

const COMPANY_SUFFIX = /\s+(inc|incorporated|llc|l\.l\.c|corp|corporation|co|company|ltd|pc|p\.c)\.?$/i;

/** Lowercased, single-spaced, punctuation trimmed. */
function clean(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/[^\p{L}\p{N}&' .-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.'-]+|[.'-]+$/g, "");
}

/** The company name without "Inc" / "LLC" / ",": "MGL Tile Inc" → "mgl tile". */
export function coreCompanyName(name: string | null | undefined): string {
  let core = clean(name).replace(/,/g, " ");
  for (let i = 0; i < 2; i++) core = core.replace(COMPANY_SUFFIX, "").trim();
  return core;
}

/** "Leonardo (Leo)" → "leonardo"; parentheticals are nicknames, not the name. */
function contactFull(contact: string | null | undefined): string {
  return clean((contact ?? "").replace(/\([^)]*\)/g, " "));
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where `needle` appears in `haystack` as whole words (case-insensitive), or
 * -1. "MGL" is in "MGL (Marcio)" but not in "MGLX"; "Marcio" is in "Marcio
 * picks up" but not in "Marcione".
 */
function wordIndex(haystack: string, needle: string): number {
  const n = needle.trim();
  if (!n) return -1;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(n).replace(/\s+/g, "\\s+")})(?=$|[^\\p{L}\\p{N}])`, "iu");
  const m = re.exec(haystack);
  return m ? m.index + m[1].length : -1;
}

/** The text as written at `at`, `len` characters, so a hint can quote it. */
function quoteAt(text: string, at: number, needle: string): string {
  const m = new RegExp(escapeRe(needle.trim()).replace(/\s+/g, "\\s+"), "iu").exec(text.slice(at));
  return m ? m[0] : needle;
}

export type SubNameHitKind = "company" | "contact" | "alias";

export interface SubNameHit {
  kind: SubNameHitKind;
  /** The words as they appear in the text: "Marcio", "MGL Tile". */
  matched: string;
  at: number;
}

const MIN_COMPANY_CHARS = 5;
const MIN_ALIAS_CHARS = 3;

/**
 * A strict mention of this sub in free text: the full company name (5+
 * characters, "Inc" optional), the full contact name with a first AND last
 * name, or one of the sub's saved aliases. A lone first name never counts.
 */
export function subNameHit(text: string | null | undefined, sub: SubDirectoryEntry): SubNameHit | null {
  const t = text ?? "";
  if (!t.trim()) return null;
  const hits: SubNameHit[] = [];

  const full = clean(sub.company_name);
  const core = coreCompanyName(sub.company_name);
  for (const name of new Set([full, core])) {
    if (name.length < MIN_COMPANY_CHARS) continue;
    const at = wordIndex(t, name);
    if (at >= 0) hits.push({ kind: "company", matched: quoteAt(t, at, name), at });
  }

  const contact = contactFull(sub.contact_name);
  const parts = contact.split(" ").filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => p.length >= 2)) {
    const at = wordIndex(t, contact);
    if (at >= 0) hits.push({ kind: "contact", matched: quoteAt(t, at, contact), at });
  }

  for (const alias of sub.aliases ?? []) {
    const a = alias.trim();
    if (a.length < MIN_ALIAS_CHARS) continue;
    const at = wordIndex(t, a);
    if (at >= 0) hits.push({ kind: "alias", matched: quoteAt(t, at, a), at });
  }

  if (!hits.length) return null;
  hits.sort((a, b) => a.at - b.at);
  return hits[0];
}

/** Every sub strictly named in the text, in the order they appear. */
export function subNameHits(
  text: string | null | undefined,
  directory: Iterable<SubDirectoryEntry>,
): { sub: SubDirectoryEntry; hit: SubNameHit }[] {
  const out: { sub: SubDirectoryEntry; hit: SubNameHit }[] = [];
  for (const sub of directory) {
    if (isNonInstallerSub(sub)) continue;
    const hit = subNameHit(text, sub);
    if (hit) out.push({ sub, hit });
  }
  return out.sort((a, b) => a.hit.at - b.hit.at);
}

// ── Resolving a name somebody typed ─────────────────────────────

/** Words that name a kind of business, not a business. */
const GENERIC_WORDS = new Set([
  "sub", "subs", "the", "and", "of", "co", "inc", "llc", "company", "construction", "contracting",
  "contractor", "contractors", "building", "builders", "services", "service", "home", "homes",
  "group", "solutions", "pro", "pros", "crew", "guy", "guys",
]);
const TRADE_WORDS = new Set([
  "demo", "demolition", "tile", "tiles", "plumbing", "plumber", "electric", "electrical", "electrician",
  "hvac", "heating", "framing", "framer", "roofing", "roofer", "siding", "windows", "doors", "gutters",
  "painting", "painter", "paint", "plaster", "plasterer", "drywall", "flooring", "floors", "floor",
  "insulation", "masonry", "mason", "concrete", "foundation", "excavation", "landscaping", "decking",
  "deck", "carpentry", "carpenter", "cabinets", "cabinetry", "countertops", "glass", "kitchen", "kitchens",
  "bath", "bathroom",
]);

function isGenericQuery(q: string): boolean {
  const words = q.split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => GENERIC_WORDS.has(w) || TRADE_WORDS.has(w));
}

/** How a typed name matched: the first three are certain, the last two are not. */
export type SubResolveMatch = "alias" | "company" | "contact" | "company_word" | "first_name";

export interface SubResolveCandidate {
  sub: SubDirectoryEntry;
  match: SubResolveMatch;
}

export interface SubResolveResult {
  /** The best tier of matches only. Empty when nothing matched. */
  candidates: SubResolveCandidate[];
  /** Set only when exactly one sub matched by alias, company or full contact name. */
  unique: SubDirectoryEntry | null;
  /** True when the only matches are by first name: confirm before using one. */
  firstNameOnly: boolean;
}

/**
 * Resolve a sub's name as a person typed it — "TEST Tile Co", "MGL",
 * "Cosentino", "Peter Nich". Suppliers are left out.
 *
 *   alias / company / full contact name → certain; `unique` when it's one sub
 *   a word of the company name ("Cosentino") → `unique` only when one sub has it
 *   a first name ("Peter", "Marcio") → never `unique`; the caller asks
 *     ("Peter Nich (excavation) or Peter at Master Floors?")
 */
export function resolveSubName(query: string | null | undefined, directory: Iterable<SubDirectoryEntry>): SubResolveResult {
  const q = clean(query);
  const empty: SubResolveResult = { candidates: [], unique: null, firstNameOnly: false };
  if (q.length < 2) return empty;
  const qCore = coreCompanyName(q);
  const generic = isGenericQuery(q);

  const strong: SubResolveCandidate[] = [];
  const word: SubResolveCandidate[] = [];
  const first: SubResolveCandidate[] = [];

  for (const sub of directory) {
    if (isNonInstallerSub(sub)) continue;
    const full = clean(sub.company_name);
    const core = coreCompanyName(sub.company_name);
    const contact = contactFull(sub.contact_name);
    const aliases = (sub.aliases ?? []).map((a) => clean(a)).filter((a) => a.length >= 2);

    const firstName = contact.split(" ")[0] ?? "";
    const nick = clean((sub.contact_name ?? "").match(/\(([^)]+)\)/)?.[1] ?? "");
    const isFirstName = (firstName.length >= 2 && q === firstName) || (nick.length >= 2 && q === nick);

    if (aliases.includes(q)) {
      strong.push({ sub, match: "alias" });
    } else if (q === full || (qCore.length >= 2 && qCore === core) || (core.length >= MIN_COMPANY_CHARS && wordIndex(q, core) >= 0)) {
      strong.push({ sub, match: "company" });
    } else if (contact.includes(" ") && q === contact) {
      strong.push({ sub, match: "contact" });
    } else if (generic) {
      continue;
    } else if (isFirstName) {
      // "Peter" is a first name even when it's also in "Peter Nich Construction".
      first.push({ sub, match: "first_name" });
    } else if (q.length >= 3 && wordIndex(full, q) >= 0) {
      word.push({ sub, match: "company_word" });
    }
  }

  if (strong.length) return { candidates: strong, unique: strong.length === 1 ? strong[0].sub : null, firstNameOnly: false };
  if (word.length) {
    // A word that is one company's name and another sub's first name is a question, not an answer.
    const all = [...word, ...first];
    return { candidates: all, unique: all.length === 1 ? word[0].sub : null, firstNameOnly: false };
  }
  if (first.length) return { candidates: first, unique: null, firstNameOnly: true };
  return empty;
}

/** "Master Floors Sandg & Repair Inc (Peter · flooring)" — for a question back to the user. */
export function describeSub(sub: SubDirectoryEntry): string {
  const trades = (sub.trades ?? []).map((t) => normalizeTrade(t)).filter((t): t is string => !!t).slice(0, 3);
  const parts: string[] = [];
  const contact = (sub.contact_name ?? "").replace(/\s+/g, " ").trim();
  const first = contactFull(contact).split(" ")[0] ?? "";
  if (contact && !(first && wordIndex(clean(sub.company_name), first) >= 0)) parts.push(contact);
  if (trades.length) parts.push(trades.join(", ").replace(/_/g, " "));
  return parts.length ? `${subName(sub)} (${parts.join(" · ")})` : subName(sub);
}

// ── Learning an alias from the office's own pick ────────────────

/**
 * The word in this phase's name or notes the office probably meant by this
 * sub — the contact's first name ("Marcio"), a nickname in parentheses, or an
 * all-caps company short name ("MGL") — when it isn't already an alias and
 * no other sub answers to it. Offered as "Remember: 'Marcio' in notes means
 * MGL Tile Inc"; nothing is saved unless the office taps it.
 */
export function aliasOfferFor(
  phase: { name?: string | null; notes?: string | null },
  sub: SubDirectoryEntry,
  directory: Iterable<SubDirectoryEntry>,
): string | null {
  const text = `${phase.name ?? ""}\n${phase.notes ?? ""}`;
  if (!text.trim()) return null;
  const have = new Set((sub.aliases ?? []).map((a) => clean(a)));

  const tokens: string[] = [];
  const contactWords = (sub.contact_name ?? "").replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
  if (contactWords[0]) tokens.push(contactWords[0]);
  const nick = (sub.contact_name ?? "").match(/\(([^)]+)\)/)?.[1]?.trim();
  if (nick) tokens.push(nick);
  const companyFirst = (sub.company_name ?? "").trim().split(/\s+/)[0] ?? "";
  if (/^[A-Z0-9&]{2,6}$/.test(companyFirst)) tokens.push(companyFirst);

  const others = Array.from(directory).filter((s) => s.id !== sub.id);
  for (const token of tokens) {
    const t = clean(token);
    if (t.length < MIN_ALIAS_CHARS || have.has(t) || isGenericQuery(t)) continue;
    const at = wordIndex(text, token);
    if (at < 0) continue;
    // Two subs answer to "Peter": the word can't mean just one of them.
    const clash = others.some((o) => {
      const first = contactFull(o.contact_name).split(" ")[0] ?? "";
      const oNick = clean((o.contact_name ?? "").match(/\(([^)]+)\)/)?.[1] ?? "");
      return first === t || oNick === t || (o.aliases ?? []).some((a) => clean(a) === t);
    });
    if (clash) continue;
    return quoteAt(text, at, token);
  }
  return null;
}

/** May this word be saved as this sub's alias? Null when yes, otherwise why not. */
export function aliasProblem(
  alias: string,
  sub: SubDirectoryEntry,
  directory: Iterable<SubDirectoryEntry>,
): string | null {
  const a = clean(alias);
  if (a.length < MIN_ALIAS_CHARS) return "An alias needs at least 3 letters.";
  if (a.length > 40) return "Keep the alias under 40 characters.";
  if (isGenericQuery(a)) return `"${alias.trim()}" is a trade or a common word, not a name.`;
  for (const other of directory) {
    if (other.id === sub.id) continue;
    if ((other.aliases ?? []).some((x) => clean(x) === a)) {
      return `"${alias.trim()}" already means ${subName(other)}.`;
    }
    const first = contactFull(other.contact_name).split(" ")[0] ?? "";
    if (first === a) return `${subName(other)} also has a ${alias.trim()}, so the word can't mean just one sub.`;
  }
  return null;
}

// ── Ranked suggestions ──────────────────────────────────────────

export type SubSuggestionSource = "awarded_line" | "quote" | "on_job" | "named" | "billed_here" | "top_biller";

export interface SubSuggestion {
  subId: string;
  name: string;
  trades: string[];
  source: SubSuggestionSource;
  /** One line for the chip: "Quote accepted on this job", "Named in notes: “MGL Tile”". */
  reason: string;
  /** 1 (best) – 6. */
  rank: number;
  /** Set for a name/notes mention. */
  named: { kind: SubNameHitKind; matched: string; where: "name" | "notes" } | null;
  /** The word to offer as an alias after the office picks this sub, if any. */
  aliasOffer: string | null;
  hasEmail: boolean;
}

export interface PhaseForSuggestions {
  id: string;
  project_id: string | null;
  name: string | null;
  notes?: string | null;
  estimate_line_item_id?: string | null;
  assigned_sub_ids?: string[] | null;
}

interface InvoiceRow {
  subcontractor_id: string;
  project_id: string | null;
  trade: string | null;
  amount: number;
}

export interface SuggestContext {
  directory: Map<string, SubDirectoryEntry>;
  awardedByLine: Map<string, string>;
  quotesByProject: Map<string, { subId: string; trade: string | null }[]>;
  onJobByProject: Map<string, string[]>;
  invoices: InvoiceRow[];
}

const RECENT_DAYS = 90;
const PAGE = 1000;

/** Bills from subs in the last 90 days, every page (PostgREST stops at 1000 rows). */
async function recentSubInvoices(db: Db, since: string): Promise<InvoiceRow[]> {
  const out: InvoiceRow[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await db
      .from("invoices")
      .select("id, subcontractor_id, project_id, trade, amount")
      .not("subcontractor_id", "is", null)
      .gte("invoice_date", since)
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data) break;
    for (const r of data as { subcontractor_id: string; project_id: string | null; trade: string | null; amount: number | string | null }[]) {
      out.push({ subcontractor_id: r.subcontractor_id, project_id: r.project_id, trade: r.trade, amount: Number(r.amount) || 0 });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/** Every active sub with what matching needs. */
export async function loadSubDirectory(db: Db): Promise<Map<string, SubDirectoryEntry>> {
  const { data } = await db
    .from("subcontractors")
    .select("id, company_name, contact_name, trades, aliases, email, is_active")
    .eq("is_active", true);
  return new Map(((data ?? []) as SubDirectoryEntry[]).map((s) => [s.id, s]));
}

/** One round of reads for any number of phases. */
export async function loadSuggestContext(
  db: Db,
  phases: PhaseForSuggestions[],
  directory?: Map<string, SubDirectoryEntry>,
): Promise<SuggestContext> {
  const lineIds = Array.from(new Set(phases.map((p) => p.estimate_line_item_id).filter((id): id is string => !!id)));
  const projectIds = Array.from(new Set(phases.map((p) => p.project_id).filter((id): id is string => !!id)));
  const since = addDays(todayET(), -RECENT_DAYS);

  const [dir, lines, quotes, links, invoices] = await Promise.all([
    directory ? Promise.resolve(directory) : loadSubDirectory(db),
    lineIds.length
      ? db.from("estimate_line_items").select("id, awarded_subcontractor_id").in("id", lineIds).not("awarded_subcontractor_id", "is", null)
      : Promise.resolve({ data: [] }),
    projectIds.length
      ? db
          .from("quote_requests")
          .select("project_id, subcontractor_id, trade, status")
          .in("project_id", projectIds)
          .in("status", [...SUB_AWARDED_QUOTE_STATUSES])
          .not("subcontractor_id", "is", null)
      : Promise.resolve({ data: [] }),
    projectIds.length
      ? db.from("project_subcontractors").select("project_id, subcontractor_id, status").in("project_id", projectIds)
      : Promise.resolve({ data: [] }),
    recentSubInvoices(db, since),
  ]);

  const awardedByLine = new Map<string, string>();
  for (const l of (lines.data ?? []) as { id: string; awarded_subcontractor_id: string | null }[]) {
    if (l.awarded_subcontractor_id) awardedByLine.set(l.id, l.awarded_subcontractor_id);
  }
  const quotesByProject = new Map<string, { subId: string; trade: string | null }[]>();
  for (const q of (quotes.data ?? []) as { project_id: string; subcontractor_id: string; trade: string | null }[]) {
    const list = quotesByProject.get(q.project_id) ?? [];
    list.push({ subId: q.subcontractor_id, trade: q.trade });
    quotesByProject.set(q.project_id, list);
  }
  const onJobByProject = new Map<string, string[]>();
  for (const r of (links.data ?? []) as { project_id: string; subcontractor_id: string; status: string | null }[]) {
    if (!isActiveProjectSub(r.status)) continue;
    const list = onJobByProject.get(r.project_id) ?? [];
    list.push(r.subcontractor_id);
    onJobByProject.set(r.project_id, list);
  }

  return { directory: dir, awardedByLine, quotesByProject, onJobByProject, invoices };
}

/** An invoice counts toward a trade when its trade says so, or it says nothing and the sub does that trade. */
function invoiceIsTrade(inv: InvoiceRow, sub: SubDirectoryEntry, trade: string): boolean {
  if (textNamesTrade(inv.trade, trade)) return true;
  const blank = !inv.trade || /^\s*(general|other|null)?\s*$/i.test(inv.trade);
  return blank && subDoesTrade(sub.trades, trade);
}

export interface PhaseSuggestions {
  trade: string | null;
  tradeLabel: string | null;
  suggestions: SubSuggestion[];
  /** "Notes say Marcio → MGL Tile Inc": the first strict mention, whether or not it made the top 3. */
  notesHint: { subId: string; subName: string; matched: string; kind: SubNameHitKind } | null;
}

/** Up to `limit` subs for one phase, best first, each with its reason. */
export function suggestSubsForPhase(phase: PhaseForSuggestions, ctx: SuggestContext, limit = 3): PhaseSuggestions {
  const trade = tradeForPhaseName(phase.name);
  const label = trade ? tradeLabel(trade) : null;
  const assigned = new Set(phase.assigned_sub_ids ?? []);
  const best = new Map<string, { rank: number; source: SubSuggestionSource; reason: string; named: SubSuggestion["named"]; weight: number }>();

  const offer = (subId: string, rank: number, source: SubSuggestionSource, reason: string, named: SubSuggestion["named"] = null, weight = 0) => {
    const sub = ctx.directory.get(subId);
    if (!sub || assigned.has(subId) || isNonInstallerSub(sub)) return;
    const prev = best.get(subId);
    if (!prev || rank < prev.rank || (rank === prev.rank && weight > prev.weight)) {
      best.set(subId, { rank, source, reason, named: named ?? prev?.named ?? null, weight });
    }
  };

  // 1. The line's award.
  const awarded = phase.estimate_line_item_id ? ctx.awardedByLine.get(phase.estimate_line_item_id) : undefined;
  if (awarded) offer(awarded, 1, "awarded_line", "Awarded this budget line");

  const projectId = phase.project_id;
  if (trade && projectId) {
    // 2. An accepted quote for this trade on this job.
    for (const q of ctx.quotesByProject.get(projectId) ?? []) {
      if (textNamesTrade(q.trade, trade)) offer(q.subId, 2, "quote", "Quote accepted on this job");
    }
    // 3. On this job already, and does this trade.
    for (const subId of ctx.onJobByProject.get(projectId) ?? []) {
      const sub = ctx.directory.get(subId);
      if (sub && subDoesTrade(sub.trades, trade)) offer(subId, 3, "on_job", "On this job");
    }
  }

  // 4. Named in the phase itself — strictly.
  let notesHint: PhaseSuggestions["notesHint"] = null;
  const fields: { where: "name" | "notes"; text: string | null | undefined }[] = [
    { where: "name", text: phase.name },
    { where: "notes", text: phase.notes },
  ];
  for (const f of fields) {
    for (const { sub, hit } of subNameHits(f.text, ctx.directory.values())) {
      if (!notesHint && !assigned.has(sub.id)) {
        notesHint = { subId: sub.id, subName: subName(sub), matched: hit.matched, kind: hit.kind };
      }
      offer(sub.id, 4, "named", `Named in ${f.where === "name" ? "the phase" : "notes"}: “${hit.matched}”`, {
        kind: hit.kind,
        matched: hit.matched,
        where: f.where,
      });
    }
  }

  if (trade) {
    // 5 and 6. Who has billed this trade: here, then anywhere.
    const here = new Map<string, number>();
    const anywhere = new Map<string, number>();
    for (const inv of ctx.invoices) {
      const sub = ctx.directory.get(inv.subcontractor_id);
      if (!sub || !invoiceIsTrade(inv, sub, trade)) continue;
      anywhere.set(inv.subcontractor_id, (anywhere.get(inv.subcontractor_id) ?? 0) + inv.amount);
      if (projectId && inv.project_id === projectId) {
        here.set(inv.subcontractor_id, (here.get(inv.subcontractor_id) ?? 0) + inv.amount);
      }
    }
    for (const [subId, total] of here) offer(subId, 5, "billed_here", `Billed ${label?.toLowerCase()} here (90 days)`, null, total);
    const top = Array.from(anywhere.entries()).filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1]).slice(0, limit);
    for (const [subId, total] of top) offer(subId, 6, "top_biller", `Top ${label?.toLowerCase()} sub (90 days)`, null, total);
  }

  const directory = Array.from(ctx.directory.values());
  const suggestions: SubSuggestion[] = Array.from(best.entries())
    .sort((a, b) => a[1].rank - b[1].rank || b[1].weight - a[1].weight || subName(ctx.directory.get(a[0])!).localeCompare(subName(ctx.directory.get(b[0])!)))
    .slice(0, limit)
    .map(([subId, s]) => {
      const sub = ctx.directory.get(subId)!;
      // A strict hit already names him; the alias offer is for the first-name case.
      const aliasOffer = s.named ? null : aliasOfferFor(phase, sub, directory);
      return {
        subId,
        name: subName(sub),
        trades: (sub.trades ?? []).map((t) => normalizeTrade(t)).filter((t): t is string => !!t),
        source: s.source,
        reason: s.reason,
        rank: s.rank,
        named: s.named,
        aliasOffer,
        hasEmail: !!sub.email?.trim(),
      };
    });

  return { trade, tradeLabel: label, suggestions, notesHint };
}
