/**
 * Proposal readiness — the send gate.
 *
 * Pure function over an estimate's line items plus the walkthrough checklist.
 * Answers three questions before a proposal goes out:
 *   1. How much of the price is a sub trade we have NOT quoted?
 *   2. What does the planned margin look like once those carries are
 *      corrected by how much that trade has historically run over?
 *   3. Which walkthrough triggers are still open with no allowance line?
 *
 * Historical overrun by trade comes from closed jobs (invoices vs the
 * contract estimate, Sept 2026): electrical +27%, plaster +18%,
 * plumbing +9%, HVAC +7%. Tile, flooring, painting, insulation came in
 * at or under, so they carry 0.
 */

import { lineCost, linePrice } from "./line-item-financials";
import type { ChecklistAnswers, ChecklistQuestion } from "@/lib/constants/walkthrough-checklist";
import { checklistLineMarker } from "@/lib/constants/walkthrough-checklist";

export interface ReadinessLine {
  id: string;
  description: string;
  trade?: string | null;
  section?: string | null;
  notes?: string | null;
  source?: string | null;
  needs_sub_quote?: boolean | null;
  quote_status?: string | null;
  awarded_bid_id?: string | null;
  sub_quote_id?: string | null;
  is_allowance?: boolean | null;
  is_section_header?: boolean | null;
  cost?: number | string | null;
  client_price?: number | string | null;
  total_cost?: number | string | null;
  total_price?: number | string | null;
}

export const SUB_TRADES = [
  "plumbing", "electrical", "hvac", "plaster", "drywall", "tile", "painting", "paint",
  "flooring", "insulation", "roofing", "siding", "glass", "masonry", "concrete", "stone",
] as const;

/** Share of the carried cost that the trade has historically exceeded. */
export const HISTORICAL_OVERRUN: Record<string, number> = {
  electrical: 0.27,
  plaster: 0.18,
  drywall: 0.18,
  plumbing: 0.09,
  hvac: 0.07,
  concrete: 0.10,
  masonry: 0.10,
};
const DEFAULT_SUB_OVERRUN = 0.05;

export const READINESS_THRESHOLDS = {
  /** Unquoted share of price above this is a caution. */
  unquotedCaution: 0.15,
  /** Above this the proposal is not ready. */
  unquotedBlock: 0.35,
  /** Risk-adjusted margin below this is a caution. */
  marginFloor: 20,
};

export type ReadinessVerdict = "ready" | "caution" | "not_ready";

export interface TradeExposure {
  trade: string;
  unquotedPrice: number;
  unquotedCost: number;
  overrunPct: number;
  expectedOverrun: number;
  lineIds: string[];
}

export interface OpenTrigger {
  key: string;
  label: string;
  answer: "yes" | "unknown";
  trade: string;
}

export interface ReadinessReport {
  verdict: ReadinessVerdict;
  totalPrice: number;
  totalCost: number;
  plannedMarginPct: number;
  riskAdjustedMarginPct: number;
  unquotedPrice: number;
  unquotedShare: number;
  expectedOverrun: number;
  byTrade: TradeExposure[];
  openTriggers: OpenTrigger[];
  unansweredCount: number;
  hasContingency: boolean;
  reasons: string[];
}

const TRADE_KEYWORDS: Array<[RegExp, string]> = [
  [/plumb/i, "plumbing"],
  [/electric/i, "electrical"],
  [/hvac|mini.?split|heat pump|ductless|air handler|condenser/i, "hvac"],
  [/plaster|blueboard|drywall|sheetrock/i, "plaster"],
  [/\btile\b/i, "tile"],
  [/paint/i, "painting"],
  [/floor(ing)?\b.*(lvp|vinyl|hardwood|refinish)|hardwood|lvp/i, "flooring"],
  [/insulat/i, "insulation"],
  [/roof/i, "roofing"],
  [/siding/i, "siding"],
  [/glass|shower door/i, "glass"],
  [/mason|brick|stone/i, "masonry"],
  [/concrete|slab|footing/i, "concrete"],
];

/** Resolve a line's trade: explicit column, then its section header, then keywords. */
export function resolveLineTrade(line: ReadinessLine, sectionName: string | null): string | null {
  const explicit = line.trade?.trim().toLowerCase();
  if (explicit) return explicit;
  for (const text of [line.description, line.section ?? "", sectionName ?? ""]) {
    for (const [re, trade] of TRADE_KEYWORDS) if (re.test(text)) return trade;
  }
  return null;
}

function isQuoted(line: ReadinessLine): boolean {
  if (line.awarded_bid_id || line.sub_quote_id) return true;
  if (line.quote_status === "quoted") return true;
  const src = (line.source ?? "").toLowerCase();
  if (/sub_quote|invoice:|quote/.test(src) && !/placeholder|pending|no-comp/.test(src)) return true;
  return false;
}

function isMarkedUnquoted(line: ReadinessLine): boolean {
  const n = (line.notes ?? "").toLowerCase();
  const s = (line.source ?? "").toLowerCase();
  return /not quoted|needs quote|rfq required|placeholder/.test(n) || /placeholder|pending/.test(s);
}

export function assessReadiness(input: {
  lineItems: ReadinessLine[];
  projectType?: string | null;
  checklist?: { questions: ChecklistQuestion[]; answers: ChecklistAnswers } | null;
}): ReadinessReport {
  const { lineItems, projectType, checklist } = input;

  // Walk in order so each line knows its section header.
  let currentSection: string | null = null;
  let totalPrice = 0;
  let totalCost = 0;
  const trades = new Map<string, TradeExposure>();
  let hasContingency = false;

  for (const li of lineItems) {
    if (li.is_section_header) {
      currentSection = li.description;
      continue;
    }
    const price = linePrice(li);
    const cost = lineCost(li);
    totalPrice += price;
    totalCost += cost;

    if (/contingen|concealed|unforeseen/i.test(li.description)) hasContingency = true;

    const trade = resolveLineTrade(li, currentSection);
    const subTrade = trade !== null && (SUB_TRADES as readonly string[]).includes(trade);
    const marked = isMarkedUnquoted(li);
    const isSub = subTrade || li.needs_sub_quote === true || marked;
    if (!isSub || li.is_allowance) continue;
    if (isQuoted(li) && !marked) continue;

    const key = trade ?? "sub";
    const overrunPct = HISTORICAL_OVERRUN[key] ?? DEFAULT_SUB_OVERRUN;
    const entry = trades.get(key) ?? {
      trade: key, unquotedPrice: 0, unquotedCost: 0, overrunPct, expectedOverrun: 0, lineIds: [],
    };
    entry.unquotedPrice += price;
    entry.unquotedCost += cost;
    entry.expectedOverrun = entry.unquotedCost * overrunPct;
    entry.lineIds.push(li.id);
    trades.set(key, entry);
  }

  const byTrade = [...trades.values()].sort((a, b) => b.unquotedPrice - a.unquotedPrice);
  const unquotedPrice = byTrade.reduce((s, t) => s + t.unquotedPrice, 0);
  const expectedOverrun = byTrade.reduce((s, t) => s + t.expectedOverrun, 0);
  const unquotedShare = totalPrice > 0 ? unquotedPrice / totalPrice : 0;
  const plannedMarginPct = totalPrice > 0 ? ((totalPrice - totalCost) / totalPrice) * 100 : 0;
  const riskAdjustedMarginPct =
    totalPrice > 0 ? ((totalPrice - totalCost - expectedOverrun) / totalPrice) * 100 : 0;

  // Walkthrough triggers still open: yes/unknown with no allowance line carrying the marker.
  const openTriggers: OpenTrigger[] = [];
  let unansweredCount = 0;
  if (checklist) {
    const allNotes = lineItems.map((l) => l.notes ?? "").join("\n");
    for (const q of checklist.questions) {
      const a = checklist.answers[q.key]?.answer;
      if (!a) unansweredCount += 1;
      if (q.kind !== "trigger") continue;
      const answer = a ?? "unknown";
      // The checklist is phrased so "yes" = the safe condition holds.
      if (answer === "yes") continue;
      if (allNotes.includes(checklistLineMarker(q.key))) continue;
      openTriggers.push({ key: q.key, label: q.label, answer: answer === "no" ? "yes" : "unknown", trade: q.trade });
    }
  }

  const reasons: string[] = [];
  let verdict: ReadinessVerdict = "ready";
  const bump = (v: ReadinessVerdict) => {
    if (v === "not_ready" || verdict === "ready") verdict = v;
  };

  if (unquotedShare > READINESS_THRESHOLDS.unquotedBlock) {
    bump("not_ready");
    reasons.push(`${Math.round(unquotedShare * 100)}% of the price is sub work with no quote in hand.`);
  } else if (unquotedShare > READINESS_THRESHOLDS.unquotedCaution) {
    bump("caution");
    reasons.push(`${Math.round(unquotedShare * 100)}% of the price is sub work with no quote in hand.`);
  }
  if (totalPrice > 0 && riskAdjustedMarginPct < READINESS_THRESHOLDS.marginFloor) {
    bump(riskAdjustedMarginPct < READINESS_THRESHOLDS.marginFloor - 5 ? "not_ready" : "caution");
    reasons.push(
      `Risk-adjusted margin is ${riskAdjustedMarginPct.toFixed(1)}% after historical overrun on the unquoted trades.`
    );
  }
  if (openTriggers.length > 0) {
    bump("caution");
    reasons.push(`${openTriggers.length} walkthrough trigger${openTriggers.length === 1 ? "" : "s"} open with no allowance line.`);
  }
  if (checklist && unansweredCount > 0) {
    reasons.push(`${unansweredCount} checklist question${unansweredCount === 1 ? "" : "s"} not answered on the walkthrough.`);
  }
  if (!hasContingency && projectType && ["remodel", "bathroom", "kitchen", "addition"].includes(projectType) && totalPrice > 0) {
    reasons.push("No concealed-conditions line. 14 Mall St lost $1,470 on exactly this.");
  }

  return {
    verdict,
    totalPrice,
    totalCost,
    plannedMarginPct,
    riskAdjustedMarginPct,
    unquotedPrice,
    unquotedShare,
    expectedOverrun,
    byTrade,
    openTriggers,
    unansweredCount,
    hasContingency,
    reasons,
  };
}
