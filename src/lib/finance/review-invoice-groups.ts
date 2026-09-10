import type { CaptureForReview } from "@/lib/actions/field-capture";

/** Only explicit invoice links may combine costs; a shared PDF alone is not proof. */
export function groupReviewInvoices(rows: CaptureForReview[]): CaptureForReview[] {
  const groups = new Map<string, CaptureForReview[]>();
  for (const row of rows) {
    const key = row.split_group_id ? `split:${row.split_group_id}` : `row:${row.id}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.some(row => row.review_pending !== false)).map(group => {
    if (group.length === 1) return group[0];
    const head = group.find(row => row.review_pending !== false)!;
    return {
      ...head,
      amount: group.some(row => row.amount === null) ? null :
        group.reduce((sum, row) => sum + Math.round(row.amount! * 100), 0) / 100,
      photo_url: group.find(row => row.photo_url)?.photo_url ?? null,
      has_receipt: group.some(row => row.has_receipt),
      allocations: group,
    };
  });
}

export function pendingReviewAllocations(row: CaptureForReview): CaptureForReview[] {
  return (row.allocations ?? [row]).filter(piece => piece.review_pending !== false);
}
