/** Client-facing billing basis. Legacy change orders remain fixed price. */
export interface ChangeOrderBilling {
  billing_type?: string | null;
  tm_terms?: string | null;
}

export function isTimeAndMaterials(co: ChangeOrderBilling): boolean {
  return co.billing_type === "time_materials";
}

export function timeMaterialsTermsError(co: ChangeOrderBilling): string | null {
  return isTimeAndMaterials(co) && !co.tm_terms?.trim()
    ? "Add the agreed time and materials billing terms before sending or approving this change order."
    : null;
}

export function changeOrderApprovalError(co: ChangeOrderBilling & {
  status: string;
  sent_to_client_at?: string | null;
}): string | null {
  if (co.status !== "submitted" || !co.sent_to_client_at) {
    return "This change order is not available for approval. Please contact Penney Construction.";
  }
  return timeMaterialsTermsError(co);
}

export const TIME_MATERIALS_AUTHORIZATION =
  "By signing below, you authorize the scope of work and the time and materials billing terms shown above. Final charges will be based on documented work and materials under those terms; this approval does not establish a fixed total.";
