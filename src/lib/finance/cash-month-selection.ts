type CashMonth = {
  key: string;
  bank: { count: number };
  records: { receiptCount: number; paidBillCount: number };
};

/** An explicit month must never be replaced with a different month's money. */
export function selectCashMonth<T extends CashMonth>(months: readonly T[], requested?: string): {
  selected: T | undefined;
  issue: "invalid" | "not_loaded" | null;
} {
  if (requested !== undefined) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)) return { selected: undefined, issue: "invalid" };
    const selected = months.find(row => row.key === requested);
    return { selected, issue: selected ? null : "not_loaded" };
  }
  const available = months.filter(row => row.bank.count > 0 || row.records.receiptCount > 0 || row.records.paidBillCount > 0)
    .sort((a, b) => b.key.localeCompare(a.key));
  return { selected: available.find(row => row.bank.count > 0) ?? available[0], issue: null };
}
