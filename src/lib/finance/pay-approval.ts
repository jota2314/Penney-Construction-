/**
 * "Good to pay" lives on two column pairs, written by two different buttons:
 *   - pay_approval_status / pay_approved_at / pay_approved_by: the Invoices
 *     list, spent detail, and the office bill dialog
 *   - approved_for_pay_at / approved_for_pay_by: the project Invoices tab
 * Both writers now stamp both pairs (9/3), but rows approved before that
 * carry only one. Read either. A bill Ryan approved on the project tab is
 * approved, whichever column it landed in.
 */
export type PayApprovalRow = {
  pay_approval_status?: string | null;
  approved_for_pay_at?: string | null;
};

export function isPayApproved(row: PayApprovalRow): boolean {
  return row.pay_approval_status === "approved" || Boolean(row.approved_for_pay_at);
}
