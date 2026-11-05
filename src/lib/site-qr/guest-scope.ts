import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSiteOpen, normalizeSiteCode } from "@/lib/sub-portal/site-code";
import { priceFreeScopeText } from "@/lib/site-qr/scope-text";

export type GuestScopeSection = { id: string; label: string; items: { title: string; description: string }[] };
export type GuestJobScope = {
  project: { name: string; number: string | null; town: string | null };
  source: { label: string; date: string | null; status: "signed" | "approved" } | null;
  sections: GuestScopeSection[];
  unavailableReason: string | null;
};

type ScopeProject = {
  id: string; name: string; project_number: string | null; city: string | null;
  status: string; is_overhead: boolean | null; contract_estimate_id: string | null;
  contract_client_signed_at: string | null; contract_locked_at: string | null;
};
type ScopeEstimate = {
  id: string; project_id: string; status: string; is_option: boolean | null;
  updated_at: string | null; created_at: string | null; version: number;
};
type ScopeLine = {
  id: string; description: string | null; proposal_description: string | null; scope_text: string | null;
  trade: string | null; sort_order: number | null; is_section_header: boolean | null;
  is_visible_on_proposal: boolean | null; change_order_id: string | null;
};
type ScopeChange = {
  id: string; title: string | null; description: string | null; status: string;
  approved_at: string | null; created_at: string | null;
};

const ESTIMATE_FIELDS = "id, project_id, status, is_option, updated_at, created_at, version";
const LINE_FIELDS = "id, description, proposal_description, scope_text, trade, sort_order, is_section_header, is_visible_on_proposal, change_order_id";
const PAGE = 500;
const MAX_ROWS = 10_000;
const APPROVED = new Set(["approved", "accepted"]);
const CURRENT = new Set(["draft", "review", "sent", "approved", "accepted"]);

function sourceDate(value: string | null): string | null {
  // Never return arbitrary source text through a date field.
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function allPages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown; count: number | null }>): Promise<T[]> {
  const rows: T[] = [];
  let expectedCount: number | null = null;
  while (rows.length < MAX_ROWS) {
    const { data, error, count } = await query(rows.length, rows.length + PAGE - 1);
    if (error || !Array.isArray(data) || count == null || (expectedCount != null && count !== expectedCount)) {
      throw new Error("Couldn't load this job's complete scope. Please try again.");
    }
    expectedCount = count;
    if (count > MAX_ROWS || (!data.length && rows.length < count)) break;
    rows.push(...data as T[]);
    if (rows.length === count) return rows;
    if (rows.length > count) break;
  }
  throw new Error("This job's scope needs an office review before it can be opened here.");
}

function isEligiblePointer(project: ScopeProject, estimate: ScopeEstimate): boolean {
  const executed = !!project.contract_client_signed_at || !!project.contract_locked_at;
  // Signing a chosen alternative does not clear its historical is_option flag.
  // Only the exact executed contract pointer can make that alternative public.
  return estimate.id === project.contract_estimate_id && estimate.project_id === project.id
    && (!estimate.is_option || executed) && CURRENT.has(estimate.status)
    && (APPROVED.has(estimate.status) || executed);
}

/** Explicit, price-free projection; source records never cross the server boundary. */
export function projectGuestScope(
  project: ScopeProject,
  estimate: ScopeEstimate | null,
  lines: ScopeLine[],
  changes: ScopeChange[],
  changeTrades: Map<string, string[]> = new Map(),
  changeDetails: Map<string, { title: string; description: string }[]> = new Map(),
): GuestJobScope {
  const result: GuestJobScope = {
    project: {
      name: priceFreeScopeText(project.name) || "Job site",
      number: priceFreeScopeText(project.project_number) || null,
      town: priceFreeScopeText(project.city) || null,
    },
    source: null, sections: [], unavailableReason: null,
  };
  if (!estimate) {
    result.unavailableReason = "The approved scope has not been published for this job yet. Please contact the Penney office.";
    return result;
  }
  const pointer = estimate.id === project.contract_estimate_id;
  result.source = {
    label: "Current approved job scope",
    date: sourceDate((pointer && (project.contract_client_signed_at || project.contract_locked_at)) || estimate.updated_at || estimate.created_at),
    status: pointer && project.contract_client_signed_at ? "signed" : "approved",
  };
  const groups = new Map<string, GuestScopeSection>();
  function add(rawTrade: string | null, title: string, description: string) {
    const label = priceFreeScopeText(rawTrade).replace(/\s+/g, " ") || "General";
    const key = label.toLowerCase();
    const cleanTitle = priceFreeScopeText(title);
    const cleanDescription = priceFreeScopeText(description);
    if (!cleanTitle && !cleanDescription) return;
    let group = groups.get(key);
    if (!group) {
      const slug = key.normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      group = { id: key === "general" ? "general" : `trade-${slug || "other"}-${groups.size + 1}`, label, items: [] };
      groups.set(key, group);
    }
    group.items.push({ title: cleanTitle || "Work scope", description: cleanDescription });
  }
  let heading = "";
  for (const line of lines) {
    if (line.is_visible_on_proposal === false || line.change_order_id) continue;
    if (line.is_section_header) { heading = priceFreeScopeText(line.description); continue; }
    const title = priceFreeScopeText(line.description);
    add(line.trade, heading && heading !== title ? `${heading} — ${title}` : title,
      line.proposal_description?.trim() || line.scope_text || "");
  }
  for (const change of changes) {
    if (change.status !== "approved") continue;
    const trades = [...new Set((changeTrades.get(change.id) || []).filter(Boolean))];
    // Multiple trades remain General so no trade's changes disappear behind a
    // filter. The filter is navigation, never a permission boundary.
    add(trades.length === 1 ? trades[0] : null,
      `Approved change: ${priceFreeScopeText(change.title) || "Additional work"}`, change.description || "");
    const seen = new Set([priceFreeScopeText(change.description).toLowerCase()]);
    for (const detail of changeDetails.get(change.id) || []) {
      const description = priceFreeScopeText(detail.description);
      if (!description || seen.has(description.toLowerCase())) continue;
      seen.add(description.toLowerCase());
      add(trades.length === 1 ? trades[0] : null,
        `Approved change: ${priceFreeScopeText(detail.title) || priceFreeScopeText(change.title) || "Additional work"}`, description);
    }
  }
  result.sections = [...groups.values()].sort((a, b) =>
    a.id === "general" ? -1 : b.id === "general" ? 1 : a.label.localeCompare(b.label));
  if (!result.sections.length) result.unavailableReason = "The approved scope has no field details available yet. Please contact the Penney office.";
  return result;
}

/**
 * The QR code itself grants this narrow read. No account, PIN, public project
 * ID, estimate ID or caller-supplied database filter is accepted.
 */
export async function loadGuestJobScope(admin: SupabaseClient, rawCode: string): Promise<GuestJobScope | null> {
  const code = normalizeSiteCode(rawCode);
  if (!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(code)) return null;
  const { data, error } = await admin.from("projects")
    .select("id, name, project_number, city, status, is_overhead, contract_estimate_id, contract_client_signed_at, contract_locked_at")
    .eq("site_code", code).maybeSingle();
  if (error) throw new Error("Couldn't open this job's scope. Please try again.");
  const project = data as ScopeProject | null;
  if (!project || !isSiteOpen({ ...project, project_number: project.project_number || "" })) return null;

  let estimate: ScopeEstimate | null = null;
  if (project.contract_estimate_id) {
    const { data: candidate, error: pointerError } = await admin.from("estimates").select(ESTIMATE_FIELDS)
      .eq("id", project.contract_estimate_id).eq("project_id", project.id).maybeSingle();
    if (pointerError) throw new Error("Couldn't load the approved scope. Please try again.");
    if (candidate && isEligiblePointer(project, candidate as ScopeEstimate)) estimate = candidate as ScopeEstimate;
  }
  if (!estimate) {
    const { data: candidate, error: fallbackError } = await admin.from("estimates").select(ESTIMATE_FIELDS)
      .eq("project_id", project.id).in("status", ["approved", "accepted"])
      .or("is_option.is.null,is_option.eq.false")
      .order("version", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (fallbackError) throw new Error("Couldn't load the approved scope. Please try again.");
    if (candidate && candidate.project_id === project.id && !candidate.is_option && APPROVED.has(candidate.status)) estimate = candidate as ScopeEstimate;
  }
  if (!estimate) return projectGuestScope(project, null, [], []);
  const estimateId = estimate.id;
  const [lines, changes] = await Promise.all([
    allPages<ScopeLine>((from, to) => admin.from("estimate_line_items").select(LINE_FIELDS, { count: "exact" })
      .eq("estimate_id", estimateId).is("change_order_id", null)
      .or("is_visible_on_proposal.is.null,is_visible_on_proposal.eq.true")
      .order("sort_order", { ascending: true }).order("id", { ascending: true }).range(from, to)),
    allPages<ScopeChange>((from, to) => admin.from("change_orders")
      .select("id, title, description, status, approved_at, created_at", { count: "exact" })
      .eq("project_id", project.id).eq("status", "approved")
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
  ]);
  const trades = new Map<string, string[]>();
  const details = new Map<string, { title: string; description: string }[]>();
  if (changes.length) {
    const links = await allPages<{ change_order_id: string; trade: string | null; description: string | null; proposal_description: string | null; scope_text: string | null; is_section_header: boolean | null; is_visible_on_proposal: boolean | null }>((from, to) => admin.from("estimate_line_items")
      .select("change_order_id, trade, description, proposal_description, scope_text, is_section_header, is_visible_on_proposal, estimates!inner(project_id)", { count: "exact" })
      .eq("estimates.project_id", project.id).eq("estimate_id", estimateId).in("change_order_id", changes.map(change => change.id))
      .or("is_visible_on_proposal.is.null,is_visible_on_proposal.eq.true")
      .order("id", { ascending: true }).range(from, to));
    for (const link of links) {
      if (link.is_visible_on_proposal === false) continue;
      const trade = priceFreeScopeText(link.trade).trim();
      if (trade) trades.set(link.change_order_id, [...(trades.get(link.change_order_id) || []), trade]);
      const description = link.proposal_description?.trim() || link.scope_text || "";
      if (!link.is_section_header && description) details.set(link.change_order_id,
        [...(details.get(link.change_order_id) || []), { title: link.description || "", description }]);
    }
  }
  return projectGuestScope(project, estimate, lines, changes, trades, details);
}

export function getGuestJobScope(code: string): Promise<GuestJobScope | null> {
  return loadGuestJobScope(createAdminClient(), code);
}
