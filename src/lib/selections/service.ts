import type { SupabaseClient } from "@supabase/supabase-js";
import {
  allowanceCharge,
  ladderProblems,
  PRICE_SOURCE_LABEL,
  STAGE_LABEL,
  type PriceSource,
  type Stage,
} from "./ladder";

// The one code path for the selections log. The app's routes and the Penney
// MCP (through /api/selections) both call these functions, so an update looks
// the same whoever makes it: same rules, same history row.

export class SelectionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export interface Actor { name: string; profileId: string | null }

export const ITEM_COLUMNS =
  "id, project_id, section, sort_order, name, brand_model, details, image_bucket, image_path, product_url, link_label, stage, selected_source, quantity, unit, quantity_note, unit_price, ext_price, price_source, price_ref, price_date, price_note, price_pending, taxable, allowance_line_id, allowance_group, vendor, order_ref, ordered_at, delivered_at, installed_at, created_by, updated_by, created_at, updated_at";

export interface SelectionItem {
  id: string; project_id: string; section: string | null; sort_order: number;
  name: string; brand_model: string | null; details: string | null;
  image_bucket: string | null; image_path: string | null; product_url: string | null; link_label: string | null;
  stage: Stage; selected_source: string | null;
  quantity: number | null; unit: string | null; quantity_note: string | null;
  unit_price: number | null; ext_price: number | null;
  price_source: PriceSource | null; price_ref: string | null; price_date: string | null; price_note: string | null;
  price_pending: boolean; taxable: boolean;
  allowance_line_id: string | null; allowance_group: string | null;
  vendor: string | null; order_ref: string | null; ordered_at: string | null; delivered_at: string | null; installed_at: string | null;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}

/** Fields a writer may set. Everything else (ids, audit stamps) is ours. */
export const EDITABLE = [
  "section", "sort_order", "name", "brand_model", "details", "image_bucket", "image_path", "product_url", "link_label",
  "stage", "selected_source", "quantity", "unit", "quantity_note", "unit_price", "ext_price", "price_source", "price_ref",
  "price_date", "price_note", "price_pending", "taxable", "allowance_line_id", "allowance_group", "vendor", "order_ref",
  "ordered_at", "delivered_at", "installed_at",
] as const;
export type EditableField = (typeof EDITABLE)[number];
export type ItemPatch = Partial<Pick<SelectionItem, EditableField>>;

const num = (v: unknown) => (v == null ? null : Number(v));
export function normalize(row: Record<string, unknown>): SelectionItem {
  return { ...(row as unknown as SelectionItem), quantity: num(row.quantity), unit_price: num(row.unit_price), ext_price: num(row.ext_price) };
}

function pickEditable(input: Record<string, unknown>): ItemPatch {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (Object.hasOwn(input, k)) out[k] = input[k];
  return out as ItemPatch;
}

function check(item: SelectionItem) {
  const problems = ladderProblems(item);
  if (problems.length) throw new SelectionError(problems.join(" "));
}

// ── read ────────────────────────────────────────────────────────────────

export async function listSelections(sb: SupabaseClient, projectId: string, opts: { includeRemoved?: boolean; history?: number } = {}) {
  let q = sb.from("selection_items").select(ITEM_COLUMNS).eq("project_id", projectId)
    .order("sort_order", { ascending: true }).order("created_at", { ascending: true });
  if (!opts.includeRemoved) q = q.neq("stage", "removed");
  const [{ data, error }, allowances, events] = await Promise.all([
    q,
    allowanceCheck(sb, projectId),
    sb.from("selection_item_events").select("item_id, at, actor, action, changes, source, note")
      .eq("project_id", projectId).order("at", { ascending: false }).limit(opts.history ?? 30),
  ]);
  if (error) throw new SelectionError(error.message, 500);
  const items = (data || []).map((r) => normalize(r as Record<string, unknown>));
  const byStage: Record<string, number> = {};
  for (const i of items) byStage[i.stage] = (byStage[i.stage] ?? 0) + 1;
  return {
    items,
    counts: { ...byStage, price_pending: items.filter((i) => i.price_pending).length },
    allowances,
    recent_changes: events.data || [],
  };
}

/**
 * Each contract allowance line vs what the log has drawn against it:
 * product price + 6.25% tax (taxable items) + that line's own markup.
 */
export async function allowanceCheck(sb: SupabaseClient, projectId: string) {
  const { data: proj } = await sb.from("projects").select("contract_estimate_id").eq("id", projectId).maybeSingle();
  let estimateId = proj?.contract_estimate_id as string | null;
  if (!estimateId) {
    const { data: est } = await sb.from("estimates").select("id").eq("project_id", projectId)
      .in("status", ["accepted", "sent"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    estimateId = (est?.id as string) ?? null;
  }
  if (!estimateId) return { estimate_id: null, lines: [] as AllowanceLine[] };
  const [{ data: lines }, { data: items }] = await Promise.all([
    sb.from("estimate_line_items").select("id, description, total_price, total_cost, markup_pct")
      .eq("estimate_id", estimateId).eq("is_allowance", true).order("sort_order"),
    sb.from("selection_items").select("id, name, ext_price, taxable, price_pending, stage, allowance_line_id")
      .eq("project_id", projectId).neq("stage", "removed").not("allowance_line_id", "is", null),
  ]);
  const out: AllowanceLine[] = (lines || []).map((l) => {
    const markup = Number(l.markup_pct || 0);
    const mine = (items || []).filter((i) => i.allowance_line_id === l.id);
    const priced = mine.filter((i) => i.ext_price != null);
    // Tax and markup apply to the line's total once (rounded once), the way
    // the selection sheet computes it — per-item rounding drifts by pennies.
    const sum = (taxable: boolean) => priced.filter((i) => i.taxable === taxable).reduce((s, i) => s + Math.round(Number(i.ext_price) * 100), 0) / 100;
    const used = Math.round((allowanceCharge(sum(true), true, markup) + allowanceCharge(sum(false), false, markup)) * 100) / 100;
    const allowance = Number(l.total_price || 0);
    return {
      line_id: l.id as string,
      name: l.description as string,
      allowance,
      markup_pct: markup,
      used,
      remaining: Math.round((allowance - used) * 100) / 100,
      items: mine.length,
      pending_items: mine.filter((i) => i.ext_price == null || i.price_pending).map((i) => i.name as string),
    };
  });
  return { estimate_id: estimateId, lines: out };
}
export interface AllowanceLine {
  line_id: string; name: string; allowance: number; markup_pct: number; used: number; remaining: number;
  items: number; pending_items: string[];
}

// ── write ───────────────────────────────────────────────────────────────

async function logEvent(sb: SupabaseClient, e: {
  item_id: string; project_id: string; actor: Actor; action: string;
  changes: Record<string, [unknown, unknown]>; source?: string | null; note?: string | null;
}) {
  await sb.from("selection_item_events").insert({
    item_id: e.item_id, project_id: e.project_id, actor: e.actor.name, actor_profile_id: e.actor.profileId,
    action: e.action, changes: e.changes, source: e.source ?? null, note: e.note ?? null,
  });
}

export async function addSelectionItem(
  sb: SupabaseClient, projectId: string, input: Record<string, unknown>, actor: Actor,
  meta: { source?: string | null; note?: string | null; action?: string } = {},
) {
  const patch = pickEditable(input);
  if (!patch.name || !String(patch.name).trim()) throw new SelectionError("Every item needs a name.");
  const draft = {
    stage: "proposed" as Stage, selected_source: null, unit_price: null, ext_price: null, price_source: null,
    price_ref: null, price_date: null, order_ref: null, ...patch,
  } as SelectionItem;
  check(draft);
  if (patch.allowance_line_id) await assertAllowanceLine(sb, projectId, patch.allowance_line_id);
  const { data, error } = await sb.from("selection_items")
    .insert({ ...patch, project_id: projectId, created_by: actor.name, updated_by: actor.name })
    .select(ITEM_COLUMNS).single();
  if (error) throw new SelectionError(error.message, 400);
  const item = normalize(data as Record<string, unknown>);
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(patch)) changes[k] = [null, v];
  await logEvent(sb, { item_id: item.id, project_id: projectId, actor, action: meta.action ?? "created", changes, source: meta.source, note: meta.note });
  return item;
}

export async function updateSelectionItem(
  sb: SupabaseClient, itemId: string, input: Record<string, unknown>, actor: Actor,
  meta: { source?: string | null; note?: string | null; action?: string; projectId?: string } = {},
) {
  const { data: row, error: loadErr } = await sb.from("selection_items").select(ITEM_COLUMNS).eq("id", itemId).maybeSingle();
  if (loadErr) throw new SelectionError(loadErr.message, 500);
  if (!row) throw new SelectionError("Selection item not found.", 404);
  const current = normalize(row as Record<string, unknown>);
  if (meta.projectId && current.project_id !== meta.projectId) throw new SelectionError("Selection item not found.", 404);

  const patch = pickEditable(input);
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(patch)) {
    const before = (current as unknown as Record<string, unknown>)[k];
    if (String(before ?? "") !== String(v ?? "")) changes[k] = [before ?? null, v ?? null];
  }
  if (Object.keys(changes).length === 0) return { item: current, changed: false };

  const next = { ...current, ...patch } as SelectionItem;
  check(next);
  if (patch.allowance_line_id) await assertAllowanceLine(sb, current.project_id, patch.allowance_line_id);
  const { data, error } = await sb.from("selection_items")
    .update({ ...patch, updated_by: actor.name, updated_at: new Date().toISOString() })
    .eq("id", itemId).select(ITEM_COLUMNS).single();
  if (error) throw new SelectionError(error.message, 400);
  const action = meta.action ?? (changes.stage ? "stage" : "updated");
  await logEvent(sb, { item_id: itemId, project_id: current.project_id, actor, action, changes, source: meta.source, note: meta.note });
  return { item: normalize(data as Record<string, unknown>), changed: true };
}

async function assertAllowanceLine(sb: SupabaseClient, projectId: string, lineId: string) {
  const { data } = await sb.from("estimate_line_items").select("id, is_allowance, estimates!inner(project_id)")
    .eq("id", lineId).eq("estimates.project_id", projectId).maybeSingle();
  if (!data || !data.is_allowance) throw new SelectionError("allowance_line_id must be an allowance line on this job's estimate.");
}

// ── client taps from the portal feed the log ────────────────────────────

/**
 * A client's Approve / Remove on a published sheet item updates the log row
 * it came from (when there is one), recorded as a client_tap event. Undo
 * reverts exactly the fields that tap changed, if nobody has touched them since.
 */
export async function applyClientTap(
  sb: SupabaseClient, logItemId: string, tap: "approve" | "remove" | "clear", clientName: string,
) {
  const { data: row } = await sb.from("selection_items").select(ITEM_COLUMNS).eq("id", logItemId).maybeSingle();
  if (!row) return;
  const item = normalize(row as Record<string, unknown>);
  const actor: Actor = { name: clientName, profileId: null };
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  if (tap === "approve") {
    if (item.stage !== "proposed") return;
    await updateSelectionItem(sb, logItemId, { stage: "selected", selected_source: `${clientName} approved on the portal ${today}` }, actor, { action: "client_tap", source: "portal" });
  } else if (tap === "remove") {
    if (item.stage === "removed" || item.stage === "ordered" || item.stage === "delivered" || item.stage === "installed") return;
    await updateSelectionItem(sb, logItemId, { stage: "removed" }, actor, { action: "client_tap", source: "portal", note: "Client removed it from the selection sheet." });
  } else {
    const { data: last } = await sb.from("selection_item_events").select("changes")
      .eq("item_id", logItemId).eq("action", "client_tap").order("at", { ascending: false }).limit(1).maybeSingle();
    const changes = (last?.changes ?? {}) as Record<string, [unknown, unknown]>;
    const revert: Record<string, unknown> = {};
    for (const [k, [before, after]] of Object.entries(changes)) {
      if (String((item as unknown as Record<string, unknown>)[k] ?? "") === String(after ?? "")) revert[k] = before;
    }
    if (Object.keys(revert).length) {
      await updateSelectionItem(sb, logItemId, revert, actor, { action: "client_tap", source: "portal", note: "Client undid their tap." });
    }
  }
}

// ── sheet revisions (what the client sees) ──────────────────────────────

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function snapshotStatus(i: SelectionItem): { status: string; label: string | null } {
  if (i.price_pending && (i.stage === "proposed" || i.stage === "selected")) return { status: "pending", label: "Price pending" };
  switch (i.stage) {
    case "proposed": return { status: "proposed", label: null };
    case "selected": return { status: "selected", label: null };
    case "priced": return { status: "selected", label: "Selected · priced" };
    case "ordered": return { status: "ordered", label: null };
    case "delivered": return { status: "ordered", label: "Delivered" };
    case "installed": return { status: "installed", label: null };
    case "reused": return { status: "reused", label: null };
    case "owner_supplied": return { status: "selected", label: "Owner-supplied" };
    default: return { status: "pending", label: null };
  }
}

/**
 * Freeze the log into a new DRAFT sheet revision (R1, R2, …) for the portal.
 * Never published here — publishing stays a human click in the Portal tab.
 * Display settings and notes carry over from the previous revision.
 */
export async function draftSheetRevision(sb: SupabaseClient, projectId: string, actor: Actor, opts: { title?: string; intro?: string | null } = {}) {
  const { items } = await listSelections(sb, projectId);
  if (items.length === 0) throw new SelectionError("This job has no selections in the log yet.");
  const { data: prev } = await sb.from("client_selection_sheets")
    .select("revision, title, intro, show_prices, show_allowances, notes, allowance_note")
    .eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { count } = await sb.from("client_selection_sheets").select("id", { count: "exact", head: true }).eq("project_id", projectId);
  const prevNum = prev?.revision ? Number(String(prev.revision).replace(/\D/g, "")) : 0;
  const revision = `R${Math.max(prevNum, count ?? 0) + 1}`;
  const allowances = await allowanceCheck(sb, projectId);

  const { data: sheet, error } = await sb.from("client_selection_sheets").insert({
    project_id: projectId,
    title: opts.title ?? prev?.title ?? "Fixture + Finish Selections",
    revision,
    sheet_date: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    intro: opts.intro ?? prev?.intro ?? null,
    show_prices: prev?.show_prices ?? false,
    show_allowances: prev?.show_allowances ?? false,
    allowances: allowances.lines.map((l) => ({
      name: l.name, allowance: l.allowance, selected: l.used > 0 ? l.used : null,
      status: l.pending_items.length
        ? `${money(l.remaining)} left; pending: ${l.pending_items.join(", ")}`
        : l.items ? `${money(Math.abs(l.remaining))} ${l.remaining >= 0 ? "under" : "over"}` : "Nothing selected yet",
    })),
    allowance_note: prev?.allowance_note ?? "Product price plus 6.25% sales tax and the contract's allowance markup, so it compares directly with the allowance. Credits and additional amounts are settled by written change order once selections are final.",
    notes: prev?.notes ?? [],
    published_at: null,
  }).select("id, revision").single();
  if (error || !sheet) throw new SelectionError(error?.message ?? "Could not create the sheet.", 500);

  const rows = items.map((i, idx) => {
    const st = snapshotStatus(i);
    const qty = i.quantity_note || (i.quantity != null ? `${i.quantity}${i.unit ? ` ${i.unit}` : ""}` : null);
    return {
      sheet_id: sheet.id, log_item_id: i.id, section: i.section, sort_order: idx, status: st.status, status_label: st.label,
      name: i.name, brand_model: i.brand_model, details: i.details, image_bucket: i.image_bucket, image_path: i.image_path,
      product_url: i.product_url, link_label: i.link_label, quantity: qty,
      unit_price: i.unit_price != null ? `${money(i.unit_price)}${i.unit ? ` / ${i.unit}` : " each"}` : i.price_pending ? "Not yet priced" : null,
      ext_price: i.ext_price,
      price_note: i.price_source ? [PRICE_SOURCE_LABEL[i.price_source], i.price_ref, i.price_date].filter(Boolean).join(", ") : i.price_note,
    };
  });
  const { error: itemsErr } = await sb.from("client_selection_items").insert(rows);
  if (itemsErr) throw new SelectionError(itemsErr.message, 500);
  return { sheet_id: sheet.id as string, revision: sheet.revision as string, items: rows.length, published: false };
}

export function describeItem(i: SelectionItem) {
  return `${i.name} — ${STAGE_LABEL[i.stage]}${i.price_pending ? " (price pending)" : ""}`;
}
