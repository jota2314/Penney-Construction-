/** Keep quote evidence separate from the contractor's selling price. */
export interface PriceEvidence {
  id: string; project_id: string | null; subcontractor_name: string | null;
  trade: string | null; amount: number | null; status: string | null;
  scope_description: string | null; created_at: string; extracted_text?: string | null;
}

export function isEstimateRequest(email: {
  content_type: string | null; subject: string | null; ai_summary: string | null;
  sender_type: string | null; ai_action_required: boolean | null;
}) {
  return email.content_type === "inquiry" && email.ai_action_required === true &&
    ["client", "internal"].includes(email.sender_type || "") &&
    /estimat|quot|bid\b|pricing|remodel|renovat|potential job|project prospect/i.test(`${email.subject || ""} ${email.ai_summary || ""}`);
}

export function normalizeUnit(value: string | null | undefined) {
  const unit = (value || "").trim().toLowerCase();
  return ({ each: "ea", count: "ea", sf: "sqft", "sq ft": "sqft", lf: "lnft", linear_ft: "lnft", "linear feet": "lnft", hr: "hour", hours: "hour", lump_sum: "ls", "lump sum": "ls" } as Record<string, string>)[unit] || unit;
}

/** AI proposes unit rates; arithmetic and missing-input flags are deterministic. */
export function checkedPrice(scope: { quantity: number | null; unit: string | null; confidence?: string; needsQuote?: boolean },
  proposed: { unit_cost?: number; unit_price?: number; unit?: string; needsQuote?: boolean; confidence?: string }) {
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const sameUnit = !!scope.unit && normalizeUnit(scope.unit) === normalizeUnit(proposed.unit);
  const validQuantity = finite(scope.quantity) && Number(scope.quantity) > 0;
  const valid = sameUnit && validQuantity && finite(proposed.unit_cost) && finite(proposed.unit_price);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    total_cost: valid ? round(Number(scope.quantity) * Number(proposed.unit_cost)) : 0,
    total_price: valid ? round(Number(scope.quantity) * Number(proposed.unit_price)) : 0,
    needsQuote: !valid || scope.needsQuote === true || proposed.needsQuote === true || scope.confidence === "low" || proposed.confidence === "low",
  };
}
