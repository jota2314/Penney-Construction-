// Chart-of-accounts categorization for vendor spend — the ONE place that
// decides which QBO account a bill books to. The QuickBooks expense push
// (src/lib/quickbooks/expenses.ts) and the Spent page both read from here,
// so the page and the push can never drift apart on the rulebook.
// Pure module: no server imports, safe for client components too.

/**
 * Category → QBO account, matched off the budget line's description first,
 * then the invoice trade. Overhead lines are the 14 spend categories on
 * PC-2026-179; job lines are trades. Fall through to the last entry.
 */
export const OVERHEAD_ACCOUNT_RULES: Array<[RegExp, string]> = [
  [/fuel|gas/i, "Fuel Expense"],
  [/vehicle|truck|auto/i, "Auto and Truck Expenses"],
  [/insurance/i, "Insurance Expense"],
  [/tool|small equip/i, "Tools and Small Equipment"],
  [/software|subscription/i, "Software & Subscriptions"],
  [/phone|internet|utilit|rent/i, "Utilities"],
  [/payroll/i, "Payroll Salary & Wages"],
  [/professional|legal|account/i, "Legal & Accounting"],
  [/license|permit|dues/i, "Licenses and Permits"],
  [/marketing|advertis/i, "Advertising"],
  [/bank|merchant/i, "Bank Service Charges"],
  [/meal/i, "Meals and Entertainment"],
  [/./, "Office Expense"],
];

export const JOB_ACCOUNT_RULES: Array<[RegExp, string]> = [
  [/permit/i, "Permits & Fees"],
  [/dumpster|waste|disposal|dump fee|porta|toilet|protection|cleanup|clean-up/i, "Other Construction Costs"],
  [/tool|equipment rental|rental/i, "Tools and Small Equipment"],
  [/fuel|gas station/i, "Fuel Expense"],
  [/./, "Construction Materials Costs"],
];

// WHAT was bought beats WHO sold it: a dumpster is Other Construction Costs
// even when the hauler is typed as a "sub" (the In House Disposal case), and
// the vendor NAME votes too — "In House Disposal" says disposal no matter
// what the budget line says. Only when no service keyword fires does a
// subcontractor vendor mean Subcontractors Expense.
export const SERVICE_KEYWORDS =
  /permit|dumpster|waste|disposal|dump fee|porta|toilet|fuel|gas station|equipment rental/i;

export function accountNameFor(
  category: string,
  isOverhead: boolean,
  vendorType: string | null,
  vendorName?: string | null,
): string {
  const haystack = `${category} ${vendorName ?? ""}`;
  const rules = isOverhead ? OVERHEAD_ACCOUNT_RULES : JOB_ACCOUNT_RULES;

  if (SERVICE_KEYWORDS.test(haystack)) {
    for (const [pattern, account] of rules) {
      if (pattern.test(haystack)) return account;
    }
  }
  if (!isOverhead && vendorType === "subcontractor") {
    return "Subcontractors Expense";
  }
  for (const [pattern, account] of rules) {
    if (pattern.test(category)) return account;
  }
  return isOverhead ? "Office Expense" : "Construction Materials Costs";
}

/** A display bucket for one QBO account. Chip classes are full literals so Tailwind keeps them. */
export interface SpendCategory {
  key: string;
  /** Short label for chips and breakdown rows. */
  label: string;
  /** The QBO chart-of-accounts name this spend books to. */
  qbAccount: string;
  /** Pill classes: tinted bg + colored text. */
  chip: string;
  /** Solid swatch for dots and bars. */
  dot: string;
}

const cat = (key: string, label: string, qbAccount: string, chip: string, dot: string): SpendCategory => ({
  key,
  label,
  qbAccount,
  chip,
  dot,
});

export const SPEND_CATEGORIES: Record<string, SpendCategory> = {
  subs: cat("subs", "Subs", "Subcontractors Expense", "bg-violet-500/15 text-violet-500", "bg-violet-500"),
  materials: cat("materials", "Materials", "Construction Materials Costs", "bg-sky-500/15 text-sky-500", "bg-sky-500"),
  labor: cat("labor", "Labor", "Payroll Salary & Wages", "bg-lime-500/15 text-lime-600 dark:text-lime-500", "bg-lime-500"),
  site: cat("site", "Disposal & site", "Other Construction Costs", "bg-teal-500/15 text-teal-600 dark:text-teal-500", "bg-teal-500"),
  tools: cat("tools", "Tools & equip", "Tools and Small Equipment", "bg-emerald-500/15 text-emerald-600 dark:text-emerald-500", "bg-emerald-500"),
  fuel: cat("fuel", "Fuel", "Fuel Expense", "bg-rose-500/15 text-rose-500", "bg-rose-500"),
  permits: cat("permits", "Permits & fees", "Permits & Fees", "bg-cyan-500/15 text-cyan-600 dark:text-cyan-500", "bg-cyan-500"),
  vehicles: cat("vehicles", "Vehicles", "Auto and Truck Expenses", "bg-amber-500/15 text-amber-600 dark:text-amber-500", "bg-amber-500"),
  insurance: cat("insurance", "Insurance", "Insurance Expense", "bg-orange-500/15 text-orange-500", "bg-orange-500"),
  software: cat("software", "Software", "Software & Subscriptions", "bg-indigo-500/15 text-indigo-500", "bg-indigo-500"),
  utilities: cat("utilities", "Utilities & rent", "Utilities", "bg-blue-500/15 text-blue-500", "bg-blue-500"),
  professional: cat("professional", "Legal & accounting", "Legal & Accounting", "bg-purple-500/15 text-purple-500", "bg-purple-500"),
  licenses: cat("licenses", "Licenses & dues", "Licenses and Permits", "bg-fuchsia-500/15 text-fuchsia-500", "bg-fuchsia-500"),
  marketing: cat("marketing", "Marketing", "Advertising", "bg-pink-500/15 text-pink-500", "bg-pink-500"),
  bank: cat("bank", "Bank fees", "Bank Service Charges", "bg-zinc-500/15 text-zinc-500", "bg-zinc-500"),
  meals: cat("meals", "Meals", "Meals and Entertainment", "bg-yellow-500/15 text-yellow-600 dark:text-yellow-500", "bg-yellow-500"),
  office: cat("office", "Office", "Office Expense", "bg-slate-500/15 text-slate-500", "bg-slate-500"),
};

const BY_ACCOUNT: Record<string, SpendCategory> = Object.fromEntries(
  Object.values(SPEND_CATEGORIES).map((c) => [c.qbAccount, c]),
);

export interface SpendCategoryInput {
  vendorName: string | null;
  vendorType: string | null;
  trade: string | null;
  description?: string | null;
  /** Linked budget-line description, when loaded — the strongest signal. */
  lineItemText?: string | null;
  isOverhead: boolean;
}

/**
 * The display category for one invoice row — the same rules the QBO push
 * books with, with two display-only refinements:
 *  - every text field votes (budget line + trade + description joined), so a
 *    generic trade like "general" can't hide the "building permit fee" in the
 *    description. The push feeds first-non-empty, its historical behavior.
 *  - in-house labor rows (ledger imports — vendor "In-House Labor", trade
 *    "labor") surface as Labor instead of falling through to Materials,
 *    since wages aren't materials. Sub labor stays Subs.
 */
export function spendCategoryFor(inv: SpendCategoryInput): SpendCategory {
  // Ledger imports file crew wages under two vendor spellings — "In-House
  // Labor" and "Penney Construction (Labor)" — with every vendor_type under
  // the sun, so the vendor name outranks the type here.
  const inHouseLabor =
    /in.?house\s*labor|penney construction/i.test(inv.vendorName ?? "") ||
    (/\blabor\b/i.test(inv.trade ?? "") &&
      inv.vendorType !== "subcontractor" &&
      !SERVICE_KEYWORDS.test(inv.vendorName ?? ""));
  if (inHouseLabor) return SPEND_CATEGORIES.labor;

  const categoryText = [inv.lineItemText, inv.trade, inv.description].filter(Boolean).join(" ");
  const account = accountNameFor(categoryText, inv.isOverhead, inv.vendorType, inv.vendorName);
  return BY_ACCOUNT[account] ?? (inv.isOverhead ? SPEND_CATEGORIES.office : SPEND_CATEGORIES.materials);
}
