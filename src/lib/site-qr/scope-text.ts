/**
 * Field scope contains prose copied from proposals. Omitting numeric database
 * columns is insufficient: allowances and rates also appear in that prose.
 * Remove financial clauses before either the public page or PDF receives text.
 */
const AMOUNT = "[+-]?\\s*\\d(?:[\\d, .]*\\d)?(?:\\s*[km](?![a-z]))?";
const CURRENCY = "(?:USD|US\\s*dollars?|CAD|AUD|EUR|GBP|dollars?|euros?|British\\s+pounds?|cents?)";
const NUMBER_WORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and)";
const MONEY = new RegExp(`(?:\\p{Sc}\\s*${AMOUNT}|\\b${CURRENCY}\\s*${AMOUNT}|\\b${AMOUNT}\\s*${CURRENCY}\\b|\\b${NUMBER_WORD}(?:[ -]+${NUMBER_WORD})*\\s+${CURRENCY}\\b)`, "giu");
const FINANCE = /\b(?:costs?|prices?|pricing|priced|budgets?|allowances?|payments?|deposits?|subtotals?|markup|mark-up|profits?|margins?|discounts?|credits?|deductions?|fees?|charges?|invoices?|retainage|tax(?:es)?|surcharges?|reimbursements?|balances?|bill(?:ing|ed)?|compensation)\b/i;
const MONEY_WORD = /\p{Sc}|\b(?:USD|CAD|AUD|EUR|GBP|dollars?|euros?|cents?)\b/iu;
const MARK = "\uE000";
const FINANCIAL_ONLY = /^(?:[-–—•\s,:()\[\]]|including\b|includes?\b|with\b|and\b|or\b|of\b|at\b|for\b|per\b|each\b|total\b|material(?:s)?\b|labor\b|labour\b|installation\b|supply\b|fixture(?:s)?\b|owner\b|client\b|contractor\b|plus\b|less\b|to\b|from\b|\uE000|[.!?])+$/i;
const BARE_FINANCIAL_AMOUNT = new RegExp(`\\b(?:costs?|prices?|retail|MSRP|RRP|budgets?|allowances?|payments?|deposits?|subtotals?|markup|profits?|margins?|discounts?|credits?|deductions?|fees?|charges?|retainage|tax(?:es)?|balances?|compensation)\\s*(?:(?:amount|of|is|was|at|equals?)\\s*)?[:=–—-]?\\s*[+-]?(?:\\d|${NUMBER_WORD}\\b)`, "i");
const TECHNICAL_UNIT = /^\s*(?:[-–]\s*)?(?:x\s*\d|GPM|CFM|PSI|BTU|volts?|amps?|watts?|degrees?|inches?|inch|in\b|feet|foot|ft\b|LF|SF|sq\.?\s*ft|mm|cm|meters?|lbs?|pounds?|gallons?|hours?|days?|people|workers?|fixtures?|sinks?|toilets?|valves?|outlets?|lights?|doors?|windows?|showers?|brackets?|units?|pieces?|lengths?|runs?|layers?|coats?|sheets?|panels?|openings?)(?:\b|²|³)/i;

function hasFinancialTotalOrRate(text: string): boolean {
  for (const match of text.matchAll(/\b(?:total|rate|balance|due|paid|payable|quoted|quote|materials?|labor|labour)\s*(?:(?:amount|of|is|was|at|equals?)\s*)?[:=–—-]?\s*(\uE000|[+-]?\d[\d,.]*(?:\s*\/\s*\d+)?)/gi)) {
    if (match[1] === MARK || !TECHNICAL_UNIT.test(text.slice((match.index || 0) + match[0].length))) return true;
  }
  return false;
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC")
    .replace(/&#(x[\da-f]+|\d+);?/gi, (_, raw: string) => {
      const code = raw[0].toLowerCase() === "x" ? parseInt(raw.slice(1), 16) : Number(raw);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&(?:dollar|euro|pound);/gi, "$")
    .replace(/&(?:nbsp|ensp|emsp);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<\s*(?:br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\r\n?/g, "\n");
}

function cleanClause(input: string): string {
  let text = input.trim();
  if (!text) return "";
  // A detached number after a financial label or dash is not useful work
  // scope. Keep measurements with units, but do not publish a naked amount.
  if (/^[+-]?\d[\d, .]*(?:[km]|\s*%)?\.?$/i.test(text)) return "";
  const hadFinancialText = MONEY_WORD.test(text) || BARE_FINANCIAL_AMOUNT.test(text) || text.includes(MARK);
  // A parenthetical price can sit inside an otherwise useful technical line.
  text = text.replace(/\([^()]*\)|\[[^\[\]]*\]/g, part =>
    (MONEY_WORD.test(part) || BARE_FINANCIAL_AMOUNT.test(part)) ? " " : part);
  text = text.replace(MONEY, MARK);

  // Preserve a technical prefix/suffix around a clearly separated financial
  // clause. Decimal points and dimensions are deliberately not separators.
  const parts = text.split(/\s+[–—]\s+|\s+-\s+|,(?=\s*(?:(?:cost|price|budget|allowance|deposit|payment|markup|profit|margin|discount|credit|fee|total)\b|\uE000))/i);
  if (parts.length > 1) return parts.map(cleanClause).filter(Boolean).join(" — ");
  if ((text.includes(MARK) || FINANCE.test(text)) && /,(?!\d)/.test(text)) {
    return text.split(/,(?!\d)/).map(cleanClause).filter(Boolean).join(", ");
  }

  // Strip a financial tail such as "at a cost of ...", "for $...", or
  // "including an allowance of ...", keeping the actual work before it.
  text = text.replace(/\s+(?:(?:at|for|with|including|plus|less)\s+(?:(?:a|an|the)\s+)?)(?=(?:(?:cost|price|budget|allowance|deposit|payment|markup|profit|margin|discount|credit|fee|charge|total)\b|\uE000))[\s\S]*$/i, "");
  text = text.replace(/\s+(?:at|for|@)\s*\uE000(?:\s*(?:\/|per)\s*[\w²³]+)?[\s\S]*$/i, "");
  if (text.includes(MARK)) {
    text = text.replace(/\b(?:allowance|budget)\s*(?:of|:|=)?\s*\uE000\s+(?:for|covers?|includes?)\s+/gi, "");
    text = text.replace(/\ballowance\s+(?=(?:includes?|covers?)\b)/gi, "");
    text = text.replace(/\s+(?:up\s+to|not\s+to\s+exceed|maximum\s+of)\s*\uE000[\s\S]*$/i, "");
    text = text.replace(/\s+(?:allowance|budget|cost|price)\s*(?:of|:|=)?\s*\uE000[\s\S]*$/i, "");
  }

  // Financial labels followed by bare figures are also prices. Do not guess
  // which numbers on an ambiguous financial line are construction dimensions.
  if ((FINANCE.test(text) && text.includes(MARK)) || BARE_FINANCIAL_AMOUNT.test(text)) return "";
  if (MONEY_WORD.test(text)) return ""; // An unrecognized monetary expression.
  if (hasFinancialTotalOrRate(text)) return "";
  if (/\d\s*%\s*(?:down|due|on\s+(?:signing|completion))/i.test(text)) return "";
  if (/(?:\d[\d,.]*\s*%?|\uE000)\s*(?:in\s+)?(?:markup|profit|margin|discount|tax|deposit|payment|credit|cost|price|allowance)\b/i.test(text)) return "";
  // Bare "for 2500" / "@ 85/hr" is a common informal quote. Ordinary
  // quantities followed by a technical unit ("for 2 showers") remain intact.
  text = text.replace(/\s+(?:for|at|@)\s+\d[\d,.]*(?:\s*[km])?(?:\s*(?:\/|per)\s*(?:hr|hour|day|sf|sq\s*ft|lf|ea|each))?(?:\s+(?:plus|including|excluding|before|after)\s+tax(?:es)?)?(?=\s*(?:[.!?]|$))/gi, "");

  if (text.includes(MARK)) {
    if (FINANCIAL_ONLY.test(text)) return "";
    // Remove known amounts and attached rate units without dropping the work.
    text = text.replace(/\uE000\s*(?:(?:\/|per)\s*(?:hr|hours?|days?|sf|sq\s*ft|lf|ea|each|unit))?/gi, "");
    text = text.replace(/\b(?:labor|labour|materials?)\s*[:=]?\s*(?=[,.;]|$)/gi, "");
  }
  text = text.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "").trim();
  if (hadFinancialText && /^(?:fixtures?|units?|supply|labor|labour|materials?)[.!?]?$/i.test(text)) return "";
  return text;
}

/** No field name, title, trade label, or prose bypasses this function. */
export function priceFreeScopeText(value: unknown): string {
  const text = normalizeText(value);
  return text.split(/\n+|;\s*|(?<=[.!?])(?<!\d\.)\s+/)
    .map(cleanClause).filter(Boolean).join("\n").trim();
}
