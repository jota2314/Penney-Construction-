import { buildDailyLog, type DailyExpense, type DailyIncome } from "./daily-log";

export const TRANSACTION_SEARCH_PAGE_SIZE = 30;

export type TransactionSearchResult = {
  id: string;
  kind: "expense" | "income" | "client_invoice" | "bank";
  name: string;
  description: string;
  reference: string | null;
  date: string | null;
  amount: number | null;
  status: string;
  projects: { id: string; label: string }[];
  href: string | null;
  review: boolean;
  source: string;
  method?: string | null;
};

export type SearchClientInvoice = {
  id: string;
  project_id: string | null;
  invoice_number: number | string | null;
  title: string | null;
  description: string | null;
  line_items: unknown;
  source: string | null;
  amount: number | null;
  paid_amount: number | null;
  status: string | null;
  invoice_date: string | null;
  created_at: string | null;
  due_date: string | null;
};

export type SearchBankTransaction = {
  id: string;
  project_id: string | null;
  txn_date: string | null;
  description: string | null;
  amount: number | null;
  direction: string | null;
  check_number: string | null;
  vendor_name: string | null;
  external_ref: string | null;
  card_last4: string | null;
  cardholder: string | null;
  category_key: string | null;
  source: string | null;
};

export type TransactionSearchData = {
  expenses: DailyExpense[];
  income: DailyIncome[];
  clientInvoices: SearchClientInvoice[];
  bank: SearchBankTransaction[];
  projects: { id: string; name: string | null; project_number: string | null }[];
};

export type TransactionSearchResponse = {
  results: TransactionSearchResult[];
  total: number;
  page: number;
  pageSize: number;
};

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/(\d),(?=\d)/g, "$1")
    .replace(/[$#]/g, "").replace(/[,_\s]+/g, " ").trim();
}

function amount(value: number | null) {
  return value === null || !Number.isFinite(Number(value)) ? null : Number(value);
}

function amountAliases(value: number | null) {
  const number = amount(value);
  return number === null ? [] : [String(number), number.toFixed(2)];
}

function dateAliases(value: string | null) {
  if (!value) return ["undated", "date needed"];
  const date = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return [value];
  const [, year, month, day] = match;
  const calendar = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(calendar.getTime())) return [date];
  return [date, `${month}/${day}/${year}`, `${Number(month)}/${Number(day)}/${year}`,
    `${month}/${day}/${year.slice(-2)}`, `${Number(month)}/${Number(day)}/${year.slice(-2)}`,
    calendar.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).replaceAll(",", ""),
    calendar.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).replaceAll(",", "")];
}

const fromQuickBooks = (source: string | null) => /^(qb(?:_|$)|quickbooks)/i.test(source ?? "");

/** Search records, not cash totals: a bank line and its booked bill remain labeled separately. */
export function searchTransactions(data: TransactionSearchData, query: string, requestedPage = 1): TransactionSearchResponse {
  const tokens = normalize(query).split(" ").filter(Boolean);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  if (!tokens.length) return { results: [], total: 0, page, pageSize: TRANSACTION_SEARCH_PAGE_SIZE };
  const projectMap = new Map(data.projects.map(project => [project.id, {
    id: project.id,
    label: [project.project_number, project.name].filter(Boolean).join(" · ") || "Job",
  }]));
  const projectsFor = (id: string | null) => id ? [projectMap.get(id) ?? { id, label: "Job" }] : [];
  const matches: TransactionSearchResult[] = [];
  function add(result: TransactionSearchResult, aliases: (string | null | undefined)[] = []) {
    const text = normalize([
      result.id, result.kind, result.name, result.description, result.reference,
      result.status, result.source, result.method, result.review ? "needs review" : "",
      ...result.projects.flatMap(project => [project.id, project.label]),
      ...dateAliases(result.date), ...amountAliases(result.amount), ...aliases,
    ].filter(Boolean).join(" "));
    if (tokens.every(token => /^-?\d+\.\d+$/.test(token)
      ? new RegExp(`(?:^|[^\\d.])${token.replace(".", "\\.")}(?=$|[^\\d.])`).test(text)
      : text.includes(token))) matches.push(result);
  }

  // Build complete groups first. Filtering raw rows first would lose allocations,
  // duplicate warnings and the original full invoice amount.
  const expenseMap = new Map(data.expenses.map(row => [row.id, row]));
  for (const transaction of buildDailyLog(data.expenses, data.income)) {
    const { id, kind, name, date, amount, status, projects, review, source, method } = transaction;
    const pieces = kind === "expense" ? transaction.recordIds.flatMap(recordId => expenseMap.get(recordId) ?? []) : [];
    const description = pieces.length ? [...new Set(pieces.map(row => row.description).filter(Boolean))].join(" · ") : transaction.description;
    const reference = pieces.length ? [...new Set(pieces.map(row => row.invoice_number).filter(Boolean))].join(" · ") || null : transaction.reference;
    const queryParams = new URLSearchParams({ section: "activity", panel: kind, id: transaction.recordIds[0] });
    if (date) queryParams.set("month", date.slice(0, 7));
    const aliases = pieces.flatMap(row => [row.id, row.vendor_name, row.description, row.invoice_number, row.source,
        row.payment_status, row.payment_method, row.review_status,
        ...dateAliases(row.invoice_date), ...amountAliases(row.amount)]);
    add({ id, kind, name, description, reference, date, amount, status, projects, review, source, method,
      href: `/finances?${queryParams}` }, [kind === "expense" ? "bill receipt expense" : "payment receipt income", ...aliases]);
  }

  for (const row of data.clientInvoices.filter(row => !fromQuickBooks(row.source))) {
    const reference = row.invoice_number === null ? null : String(row.invoice_number);
    const date = row.invoice_date ?? row.created_at?.slice(0, 10) ?? null;
    const lineDescriptions = Array.isArray(row.line_items) ? row.line_items.flatMap(item =>
      item && typeof item === "object" && "description" in item && typeof item.description === "string" ? [item.description] : []) : [];
    const description = [...new Set([row.description, ...lineDescriptions].filter(Boolean))].join(" · ");
    add({
      id: `client_invoice:${row.id}`, kind: "client_invoice", name: row.title || "Client invoice",
      description: description || row.title || "", reference, date, amount: amount(row.amount),
      status: row.status?.replaceAll("_", " ") || "Status unavailable", projects: projectsFor(row.project_id),
      href: `/api/generate-client-invoice?invoiceId=${encodeURIComponent(row.id)}`,
      review: amount(row.amount) === null, source: row.source || "Penney client invoice", method: null,
    }, ["customer invoice billing", ...(row.due_date ? dateAliases(row.due_date) : []), ...amountAliases(row.paid_amount)]);
  }

  for (const row of data.bank.filter(row => !fromQuickBooks(row.source))) {
    const direction = row.direction?.toLowerCase();
    const reference = [...new Set([row.check_number, row.external_ref].filter(Boolean))].join(" · ") || null;
    add({
      id: `bank:${row.id}`, kind: "bank", name: row.vendor_name || row.description || "Bank transaction",
      description: [row.vendor_name ? row.description : null, row.category_key?.replaceAll("_", " "), row.cardholder ? `Cardholder: ${row.cardholder}` : null].filter(Boolean).join(" · "), reference,
      date: row.txn_date, amount: amount(row.amount),
      status: direction === "debit" ? "Money out" : direction === "credit" ? "Money in" : "Bank entry",
      projects: projectsFor(row.project_id), href: null, review: amount(row.amount) === null,
      source: row.source || "Imported bank statement", method: row.check_number ? "check" : row.card_last4 ? `Card ending ${row.card_last4}` : null,
    }, ["bank statement", row.description, row.direction, row.category_key, row.card_last4, row.cardholder]);
  }

  const results = matches.sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
  const resultPage = Math.min(page, Math.max(1, Math.ceil(results.length / TRANSACTION_SEARCH_PAGE_SIZE)));
  return {
    results: results.slice((resultPage - 1) * TRANSACTION_SEARCH_PAGE_SIZE, resultPage * TRANSACTION_SEARCH_PAGE_SIZE),
    total: results.length, page: resultPage, pageSize: TRANSACTION_SEARCH_PAGE_SIZE,
  };
}
