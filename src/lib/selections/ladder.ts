// The selections ladder: the one way a product moves from "we suggested it"
// to "it's on the wall", whoever updates it (app, Penney MCP from any Claude
// session, later the email suggestions). The database enforces the same rules
// (migration 20261016233536_selections_log); this module states them in plain
// words so a refusal tells the person what's missing.

export const STAGES = ["proposed", "selected", "priced", "ordered", "delivered", "installed", "reused", "owner_supplied", "removed"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  proposed: "Proposed",
  selected: "Selected",
  priced: "Priced",
  ordered: "Ordered",
  delivered: "Delivered",
  installed: "Installed",
  reused: "Reused",
  owner_supplied: "Owner-supplied",
  removed: "Removed",
};

// Stages that mean the client has chosen it — each needs a client source.
export const CLIENT_CHOSEN: Stage[] = ["selected", "priced", "ordered", "delivered", "installed"];
// Stages that mean it was bought — each needs an order reference.
export const ORDERED: Stage[] = ["ordered", "delivered", "installed"];

export const PRICE_SOURCES = ["vendor_quote", "paid_invoice", "retail_check", "list_price"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];
export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  vendor_quote: "Vendor quote",
  paid_invoice: "Paid invoice",
  retail_check: "Retail check",
  list_price: "List price",
};

export interface SelectionItemFields {
  stage: Stage;
  selected_source: string | null;
  unit_price: number | null;
  ext_price: number | null;
  price_source: PriceSource | null;
  price_ref: string | null;
  price_date: string | null;
  order_ref: string | null;
}

/** Every rule the item breaks, in words. Empty = OK to save. */
export function ladderProblems(item: SelectionItemFields): string[] {
  const out: string[] = [];
  const hasPrice = item.unit_price != null || item.ext_price != null;
  if (hasPrice && (!item.price_source || !item.price_ref?.trim() || !item.price_date)) {
    out.push("A price needs its source (vendor quote, paid invoice, retail check or list price), the reference (quote number and line, invoice, URL) and the date. No invented prices.");
  }
  if (CLIENT_CHOSEN.includes(item.stage) && !item.selected_source?.trim()) {
    out.push(`"${STAGE_LABEL[item.stage]}" needs the client source: her email, the signed sheet, a portal tap, or Jorge saying so. A product we suggested stays "Proposed".`);
  }
  if (item.stage === "priced" && (item.ext_price == null || (item.price_source !== "vendor_quote" && item.price_source !== "paid_invoice"))) {
    out.push('"Priced" needs a firm price from a vendor quote or a paid invoice. A retail or list check keeps it at its current step with the price shown as a reference.');
  }
  if (ORDERED.includes(item.stage) && !item.order_ref?.trim()) {
    out.push(`"${STAGE_LABEL[item.stage]}" needs the order reference (order confirmation, PO or receipt number).`);
  }
  return out;
}

const TAX_RATE = 0.0625; // Massachusetts sales tax on materials

/** Product price → what it counts against the allowance: + tax (if taxable), + the allowance line's markup, half-up to the cent. */
export function allowanceCharge(extPrice: number, taxable: boolean, markupPct: number): number {
  const cents = Math.round(extPrice * 100);
  const withTax = taxable ? cents * (1 + TAX_RATE) : cents;
  const withMarkup = withTax * (1 + markupPct / 100);
  return Math.round(withMarkup + 1e-9) / 100;
}
