type Amount = number | string | null;
export function summarizeRecordedCash(
  receipts: { received_date: string | null; amount: Amount }[],
  bills: { invoice_date: string | null; amount: Amount; paid_amount: Amount; payment_status: string | null; payment_method: string | null }[],
  payoffs: { txn_date: string; amount: Amount }[],
  today: string,
) {
  const start = `${today.slice(0, 4)}-01-01`;
  const inPeriod = (day: string | null) => !!day && day >= start && day <= today;
  const cents = (value: Amount) => Math.round(Number(value || 0) * 100);
  const received = receipts.reduce((sum, row) => sum + (inPeriod(row.received_date) ? cents(row.amount) : 0), 0);
  const paid = bills.reduce((sum, row) => sum + (inPeriod(row.invoice_date) && row.payment_status === "paid" && !["capital_one", "internal"].includes(row.payment_method || "") ? cents(Number(row.paid_amount) || row.amount) : 0), 0);
  const card = payoffs.reduce((sum, row) => sum + (inPeriod(row.txn_date) ? cents(row.amount) : 0), 0);
  return { received: received / 100, spent: (paid + card) / 100, net: (received - paid - card) / 100 };
}
