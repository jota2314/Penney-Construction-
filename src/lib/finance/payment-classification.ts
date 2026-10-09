export type PayClass = "deposit" | "progress" | "final" | "change_order";

/** A receipt can cover multiple COs without linking to one change_order_id. */
export function classifyPayment(payment: {
  change_order_id: string | null;
  payment_type: string | null;
}): PayClass {
  if (payment.change_order_id || payment.payment_type === "change_order") return "change_order";
  if (payment.payment_type === "deposit") return "deposit";
  if (payment.payment_type === "final") return "final";
  return "progress"; // draw, progress, and unlabeled mid-job payments
}
