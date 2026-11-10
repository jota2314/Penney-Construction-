/**
 * What the Finance overview's "Needs attention" box lists. Jorge 11/10/26:
 * paid invoices were being flagged ("that shit is already good"); flag
 * duplicated invoices and things going to the wrong jobs instead.
 *
 * Only two kinds of finding:
 *  - duplicate: the same bill, check or client invoice entered more than once
 *  - wrong_job: a record booked to a job it doesn't belong to, or to no job
 *
 * Paid-but-unlinked checks, QuickBooks provenance, missing budget lines and
 * job cost health are not findings here. Display only: nothing in this file
 * changes a record. Amounts are cents.
 */

type Bill = {
  id: string;
  project_id: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  amount: unknown;
  split_group_id: string | null;
  estimate_line_item_id: string | null;
};
type Receipt = {
  id: string;
  project_id: string | null;
  client_invoice_id: string | null;
  amount: unknown;
  received_date: string | null;
  reference_number: string | null;
};
type ClientInvoice = {
  id: string;
  project_id: string;
  invoice_number: number;
  title: string | null;
  amount: unknown;
  status: string;
  sent_to_client_at: string | null;
};

export type AttentionItem = {
  key: string;
  kind: "duplicate" | "wrong_job";
  title: string;
  detail: string;
  /** The amount at stake: the extra copy for duplicates, the record for wrong job. */
  amount: number;
  date: string | null;
  href: string;
};

const money = (value: unknown): number | null =>
  value == null || value === "" || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 100);

const VOID = ["draft", "void", "voided", "cancelled"];

/** "CK-6280", "Check 6280" and "6280" are the same check. No digits, no match. */
function checkNumber(ref: string | null) {
  const clean = (ref ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(check|chk|ck)/, "");
  return /\d/.test(clean) ? clean : null;
}

function list(names: string[]) {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function findAttention({
  bills,
  receipts,
  invoices,
  lineJob,
  names,
}: {
  bills: Bill[];
  receipts: Receipt[];
  invoices: ClientInvoice[];
  /** Budget line id → the job whose estimate it belongs to. */
  lineJob: Map<string, string>;
  names: Map<string, string>;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const job = (id: string | null) => (id ? names.get(id) ?? "Unknown job" : "no job");
  const jobHref = (id: string | null) => (id ? `/projects/${id}?tab=finances` : "/finances?section=income");
  const vendor = (b: Bill) => b.vendor_name?.trim() || "Unknown vendor";

  // 1. Vendor bills: same vendor, bill number and date entered as separate
  // records (or separate splits) with the same total. Different totals under
  // one number are a bill legitimately split across jobs, not a copy.
  const sameBill = new Map<string, Map<string, Bill[]>>();
  for (const b of bills) {
    const num = b.invoice_number?.trim();
    if (!num || !b.invoice_date) continue;
    const key = JSON.stringify([vendor(b).toLowerCase(), num, b.invoice_date]);
    const capture = b.split_group_id ? `split:${b.split_group_id}` : `row:${b.id}`;
    const captures = sameBill.get(key) ?? new Map<string, Bill[]>();
    captures.set(capture, [...(captures.get(capture) ?? []), b]);
    sameBill.set(key, captures);
  }
  for (const [key, captures] of sameBill) {
    if (captures.size < 2) continue;
    const byTotal = new Map<number, Bill[][]>();
    for (const rows of captures.values()) {
      const amounts = rows.map((r) => money(r.amount));
      if (amounts.some((a) => a === null)) continue;
      const total = (amounts as number[]).reduce((sum, a) => sum + a, 0);
      if (!total) continue;
      byTotal.set(total, [...(byTotal.get(total) ?? []), rows]);
    }
    for (const [total, copies] of byTotal) {
      if (copies.length < 2) continue;
      const head = copies[0][0];
      const jobsOf = (rows: Bill[]) => [...new Set(rows.map((r) => r.project_id ?? ""))].sort().join("|");
      const sameJobs = new Set(copies.map(jobsOf)).size === 1;
      const jobNames = [...new Set(copies.flat().map((r) => job(r.project_id)))];
      items.push({
        key: `bill:${key}:${total}`,
        kind: sameJobs ? "duplicate" : "wrong_job",
        title: `${vendor(head)} #${head.invoice_number!.trim()}`,
        detail: sameJobs
          ? `Entered ${copies.length === 2 ? "twice" : `${copies.length} times`} on ${list(jobNames)}`
          : `Same bill on ${list(jobNames)}`,
        amount: sameJobs ? total * (copies.length - 1) : total,
        date: head.invoice_date,
        href: `/spent/${copies[1][0].id}`,
      });
    }
  }

  // 2. Vendor bills coded to another job's budget line, or to no job at all.
  for (const b of bills) {
    const amount = money(b.amount);
    const title = `${vendor(b)}${b.invoice_number?.trim() ? ` #${b.invoice_number.trim()}` : ""}`;
    const lineJobId = b.estimate_line_item_id ? lineJob.get(b.estimate_line_item_id) : undefined;
    if (b.project_id && lineJobId && lineJobId !== b.project_id)
      items.push({
        key: `line:${b.id}`, kind: "wrong_job", title,
        detail: `On ${job(b.project_id)}, coded to a ${job(lineJobId)} budget line`,
        amount: amount ?? 0, date: b.invoice_date, href: `/spent/${b.id}`,
      });
    else if (!b.project_id && amount)
      items.push({
        key: `nojob:${b.id}`, kind: "wrong_job", title, detail: "Not on any job",
        amount, date: b.invoice_date, href: `/spent/${b.id}`,
      });
  }

  // 3. Client invoices: two sent invoices on one job with the same amount and
  // the same description. Equal draws with different milestones are normal.
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const sameInvoice = new Map<string, ClientInvoice[]>();
  for (const i of invoices) {
    const amount = money(i.amount);
    if (!i.sent_to_client_at || VOID.includes(i.status) || !amount) continue;
    const key = JSON.stringify([i.project_id, amount, (i.title ?? "").trim().toLowerCase().replace(/\s+/g, " ")]);
    sameInvoice.set(key, [...(sameInvoice.get(key) ?? []), i]);
  }
  for (const [key, copies] of sameInvoice) {
    if (copies.length < 2) continue;
    const numbers = copies.map((i) => `#${i.invoice_number}`).sort();
    items.push({
      key: `invoice:${key}`, kind: "duplicate", title: job(copies[0].project_id),
      detail: `Client invoices ${list(numbers)} are the same invoice`,
      amount: (money(copies[0].amount) ?? 0) * (copies.length - 1),
      date: copies[0].sent_to_client_at?.slice(0, 10) ?? null,
      href: `${jobHref(copies[0].project_id)}#fin-invoices`,
    });
  }

  // 4. Checks: the same check number and amount logged twice, or a check
  // applied to an invoice on a different job.
  const sameCheck = new Map<string, Receipt[]>();
  for (const r of receipts) {
    const num = checkNumber(r.reference_number), amount = money(r.amount);
    if (num && amount) {
      const key = JSON.stringify([num, amount]);
      sameCheck.set(key, [...(sameCheck.get(key) ?? []), r]);
    }
    const invoice = r.client_invoice_id ? invoiceById.get(r.client_invoice_id) : undefined;
    if (invoice && invoice.project_id !== r.project_id)
      items.push({
        key: `applied:${r.id}`, kind: "wrong_job",
        title: r.reference_number ? `Check ${r.reference_number}` : "Client payment",
        detail: `Logged on ${job(r.project_id)}, applied to ${job(invoice.project_id)} invoice #${invoice.invoice_number}`,
        amount: amount ?? 0, date: r.received_date, href: jobHref(r.project_id),
      });
  }
  for (const [key, copies] of sameCheck) {
    if (copies.length < 2) continue;
    const head = copies[0];
    const jobNames = [...new Set(copies.map((r) => job(r.project_id)))];
    const sameJob = jobNames.length === 1;
    items.push({
      key: `check:${key}`, kind: sameJob ? "duplicate" : "wrong_job",
      title: `Check ${head.reference_number!.trim()}`,
      detail: sameJob
        ? `Logged ${copies.length === 2 ? "twice" : `${copies.length} times`} on ${jobNames[0]}`
        : `Same check logged on ${list(jobNames)}`,
      amount: (money(head.amount) ?? 0) * (sameJob ? copies.length - 1 : 1),
      date: head.received_date, href: jobHref(head.project_id),
    });
  }

  return items.sort(
    (a, b) =>
      Number(a.kind === "wrong_job") - Number(b.kind === "wrong_job") ||
      (b.date ?? "").localeCompare(a.date ?? "") ||
      a.key.localeCompare(b.key),
  );
}
