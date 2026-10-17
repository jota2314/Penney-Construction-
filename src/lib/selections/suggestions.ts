import type { SupabaseClient } from "@supabase/supabase-js";
import { ladderProblems, STAGE_LABEL, type SelectionItemFields, type Stage } from "./ladder";
import {
  addSelectionItem,
  ITEM_COLUMNS,
  normalize,
  SelectionError,
  updateSelectionItem,
  type Actor,
  type SelectionItem,
} from "./service";

// Email suggestions for the selections log. The fetch-emails cron reads job
// mail (email-suggestions.ts) and files each proposed change here, in the
// shared review queue (agent_suggestions). Nothing is applied until a person
// approves it; approving goes through updateSelectionItem/addSelectionItem,
// so the ladder rules, the refusal text and the history row are the same as
// any other update. Dismissing only closes the suggestion.

export const SELECTION_SUGGESTION_KIND = "selection_update";
export const SELECTION_SUGGESTION_AGENT = "selections";

export const SIGNALS = ["client_pick", "vendor_quote", "order_confirmation", "delivery_notice"] as const;
export type Signal = (typeof SIGNALS)[number];
export const SIGNAL_LABEL: Record<Signal, string> = {
  client_pick: "Client pick",
  vendor_quote: "Vendor quote",
  order_confirmation: "Order confirmation",
  delivery_notice: "Delivery notice",
};

export interface SelectionSuggestionPayload {
  v: 1;
  op: "update" | "add";
  /** The log row it changes; null when it adds a product. */
  item_id: string | null;
  item_name: string;
  /** Editable selection_items fields → new value. */
  changes: Record<string, unknown>;
  /** Those fields' values when the email was read (updates only). */
  before: Record<string, unknown>;
  signals: Signal[];
  /** How a price was tied to an existing item: its model number on the quote line, or the description only. */
  match?: "model" | "description";
  /** The exact words the change rests on, checked against the email or the attachment text. */
  evidence: { signal: Signal; where: string; text: string }[];
  /** Written to the history row on approval: the email id plus the quote line. */
  source: string;
  email: {
    id: string;
    gmail_message_id: string | null;
    subject: string | null;
    from_name: string | null;
    from_email: string | null;
    date: string | null;
  };
  warnings: string[];
}

export interface PendingSelectionSuggestion {
  id: string;
  created_at: string;
  title: string;
  detail: string | null;
  payload: SelectionSuggestionPayload;
  /** What approving applies now, field by field, and each field's current value. */
  changes: Record<string, unknown>;
  before: Record<string, unknown>;
  /** The ladder rules approving it would break right now (the app's own refusal text). */
  blocked_by: string[];
  /** Set when the item changed since the email was read, or the product is already in the log. */
  conflict: string | null;
}

const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");
const show = (field: string, v: unknown) => (field === "stage" && typeof v === "string" ? STAGE_LABEL[v as Stage] ?? v : v ?? "empty");

/** A field the suggestion changes was changed by someone else since the email was read. */
function driftOf(item: SelectionItem, p: SelectionSuggestionPayload): string | null {
  for (const [field, next] of Object.entries(p.changes)) {
    const current = (item as unknown as Record<string, unknown>)[field];
    if (same(current, next)) continue;
    if (!same(current, p.before[field])) {
      return `${item.name} changed since this email was read (${field.replace(/_/g, " ")} is now ${show(field, current)}).`;
    }
  }
  return null;
}

const key = (s: unknown) => String(s ?? "").trim().toLowerCase();

function duplicateOf(items: SelectionItem[], p: SelectionSuggestionPayload): string | null {
  const name = key(p.changes.name);
  const model = key(p.changes.brand_model);
  const hit = items.find((i) => i.stage !== "removed" && (key(i.name) === name || (model && key(i.brand_model) === model)));
  return hit ? `Already in the log as "${hit.name}".` : null;
}

/**
 * What approving applies to the item as it is now. A firm price (vendor
 * quote or paid invoice) on an item the client has chosen makes it Priced,
 * the ladder's own meaning. When the pick was approved after the quote email
 * was read, the quote's suggestion carries no step; this adds it, and the
 * panel shows it before anyone clicks.
 */
function effectiveChanges(item: SelectionItem | undefined, p: SelectionSuggestionPayload): Record<string, unknown> {
  if (!item || p.op !== "update" || p.match === "description" || "stage" in p.changes || !("ext_price" in p.changes || "price_source" in p.changes)) return p.changes;
  const next = { ...item, ...p.changes } as SelectionItem;
  const firm = next.ext_price != null && (next.price_source === "vendor_quote" || next.price_source === "paid_invoice");
  return item.stage === "selected" && firm && next.selected_source ? { ...p.changes, stage: "priced" } : p.changes;
}

const EMPTY: SelectionItemFields = {
  stage: "proposed", selected_source: null, unit_price: null, ext_price: null,
  price_source: null, price_ref: null, price_date: null, order_ref: null,
};

/** A job's pending email suggestions, each checked against the log as it is now. */
export async function listPendingSelectionSuggestions(
  sb: SupabaseClient, projectId: string, items: SelectionItem[],
): Promise<PendingSelectionSuggestion[]> {
  const { data, error } = await sb.from("agent_suggestions").select("id, created_at, title, detail, payload")
    .eq("project_id", projectId).eq("kind", SELECTION_SUGGESTION_KIND).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(50);
  if (error) throw new SelectionError(error.message, 500);
  const byId = new Map(items.map((i) => [i.id, i]));
  return (data || []).flatMap((s) => {
    const p = s.payload as SelectionSuggestionPayload | null;
    if (!p || p.v !== 1) return [];
    const item = p.item_id ? byId.get(p.item_id) : undefined;
    const conflict = p.op === "add"
      ? duplicateOf(items, p)
      : item ? driftOf(item, p) : "This item is no longer in the log.";
    const changes = effectiveChanges(item, p);
    const before = item ? Object.fromEntries(Object.keys(changes).map((k) => [k, p.before[k] ?? (item as unknown as Record<string, unknown>)[k] ?? null])) : {};
    const merged = { ...(item ?? EMPTY), ...changes } as SelectionItemFields;
    return [{
      id: s.id as string, created_at: s.created_at as string, title: s.title as string, detail: s.detail as string | null,
      payload: p, changes, before, blocked_by: ladderProblems(merged), conflict,
    }];
  });
}

/**
 * Apply an approved suggestion through the one code path. Throws
 * SelectionError with the words a person should see: the ladder's refusal,
 * "changed since", or "already in the log".
 */
export async function applySelectionSuggestion(
  sb: SupabaseClient,
  suggestion: { project_id: string | null; payload: unknown },
  actor: Actor,
): Promise<{ item_id: string; changed: boolean }> {
  const p = suggestion.payload as SelectionSuggestionPayload | null;
  const projectId = suggestion.project_id;
  if (!p || p.v !== 1 || !projectId) throw new SelectionError("This suggestion can't be applied automatically. Update the log by hand.");
  const meta = {
    source: p.source,
    note: `From the email "${p.email.subject ?? "(no subject)"}" (${p.email.from_name || p.email.from_email || "unknown sender"}), approved in the app.`,
  };

  if (p.op === "add") {
    const { data, error } = await sb.from("selection_items").select(ITEM_COLUMNS).eq("project_id", projectId).neq("stage", "removed");
    if (error) throw new SelectionError(error.message, 500);
    const dup = duplicateOf((data || []).map((r) => normalize(r as Record<string, unknown>)), p);
    if (dup) throw new SelectionError(`${dup} Dismiss this suggestion, or update that item instead.`, 409);
    const item = await addSelectionItem(sb, projectId, p.changes, actor, meta);
    return { item_id: item.id, changed: true };
  }

  if (!p.item_id) throw new SelectionError("This suggestion doesn't name an item.");
  const { data: row, error } = await sb.from("selection_items").select(ITEM_COLUMNS).eq("id", p.item_id).maybeSingle();
  if (error) throw new SelectionError(error.message, 500);
  if (!row || row.project_id !== projectId) throw new SelectionError("That item is no longer in this job's log.", 404);
  const item = normalize(row as Record<string, unknown>);
  const conflict = driftOf(item, p);
  if (conflict) throw new SelectionError(`${conflict} Dismiss this suggestion, or update the item by hand.`, 409);
  const result = await updateSelectionItem(sb, p.item_id, effectiveChanges(item, p), actor, { ...meta, projectId });
  return { item_id: p.item_id, changed: result.changed };
}
