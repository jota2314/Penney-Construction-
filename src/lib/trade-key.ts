import { REQUIRED_TRADES, TRADE_KEY_TO_LABEL } from "@/lib/constants/trade-rate";

// Trade strings arrive from many places — estimate lines ("lvl_steel"),
// AI-extracted quotes ("Electrical"), manual entry ("plumber") — and the
// Subs tab needs them all to land in the same per-trade bucket. Shared by
// server actions and client components, so keep this pure.

const LABEL_TO_KEY = new Map(
  REQUIRED_TRADES.map((t) => [t.label.toLowerCase(), t.key])
);

const TRADE_ALIASES: Record<string, string> = {
  electric: "electrical",
  electrician: "electrical",
  plumber: "plumbing",
  mechanical: "hvac",
  "hvac / mechanical": "hvac",
  paint: "painting",
  painter: "painting",
  demo: "demolition",
  gutter: "gutters",
  floor: "flooring",
  floors: "flooring",
  window: "windows",
  roof: "roofing",
  "site work": "sitework",
};

export function normalizeTradeKey(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "";
  if (TRADE_KEY_TO_LABEL[s]) return s;
  const byLabel = LABEL_TO_KEY.get(s);
  if (byLabel) return byLabel;
  const byAlias = TRADE_ALIASES[s];
  if (byAlias) return byAlias;
  return s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function tradeKeyLabel(key: string): string {
  if (TRADE_KEY_TO_LABEL[key]) return TRADE_KEY_TO_LABEL[key];
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
