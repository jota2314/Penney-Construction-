type ReceiptIdentity = {
  id: string;
  split_group_id: string | null;
  invoice_number: string | null;
  vendor_name: string;
  invoice_date: string | null;
  amount: number | null;
};

/** Presentation only: never treats repeat submissions as extra allocations. */
export function groupReceiptInvoices<T extends ReceiptIdentity>(rows: T[]) {
  const captures = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.split_group_id ? `split:${row.split_group_id}` : `row:${row.id}`;
    const group = captures.get(key) ?? [];
    group.push(row);
    captures.set(key, group);
  }
  const invoices = new Map<string, T[][]>();
  for (const [captureId, capture] of captures) {
    const head = capture[0];
    // Without an invoice number AND date, only explicit split membership is safe.
    const key = head.invoice_number?.trim() && head.invoice_date
      ? JSON.stringify([head.vendor_name.trim().toLowerCase(), head.invoice_number.trim(), head.invoice_date])
      : captureId;
    const group = invoices.get(key) ?? [];
    group.push(capture);
    invoices.set(key, group);
  }
  return [...invoices.values()].map((submissions) => {
    const totals = submissions.map((capture) => capture.some((row) => row.amount === null)
      ? null : capture.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0));
    return {
      head: submissions[0][0],
      rows: submissions.flat(),
      amount: totals[0] !== null && totals.every((total) => total === totals[0]) ? totals[0] / 100 : null,
      submissionCount: submissions.length,
      allocationCount: submissions[0].length,
    };
  });
}
