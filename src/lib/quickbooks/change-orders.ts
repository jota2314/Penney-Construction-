import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken, isQuickBooksConnected } from "./auth";
import { qbQuery, qbPost } from "./client";
import { pushProjectToQuickBooks } from "./customers";
import { ensureServiceItem } from "./invoices";

interface QBEstimateLine {
  Id?: string;
  DetailType: string;
  Amount?: number;
  Description?: string;
  SalesItemLineDetail?: { ItemRef?: { value: string } };
  [key: string]: unknown;
}

interface QBEstimate {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
  Line: QBEstimateLine[];
}

/**
 * Mirror a signed/approved change order into QuickBooks by appending it as a
 * line on the project's existing QBO Estimate (Nicole's convention: one
 * estimate per job, COs stack as lines so the estimate total always reads
 * contract plus signed COs). If the job has no estimate in QuickBooks yet,
 * a new one is created carrying just the CO line. Idempotent — a CO that
 * already has quickbooks_pushed_at set is not pushed twice.
 */
export async function pushChangeOrderToQuickBooks(
  changeOrderId: string
): Promise<{ error: string | null; qbEstimateId?: string; appended?: boolean }> {
  if (!(await isQuickBooksConnected())) {
    return { error: "QuickBooks not connected" };
  }

  const supabase = createAdminClient();

  const { data: co, error: coErr } = await supabase
    .from("change_orders")
    .select(
      "id, project_id, change_order_number, title, price_impact, status, client_signed_at, quickbooks_estimate_id, quickbooks_pushed_at, projects(project_number)"
    )
    .eq("id", changeOrderId)
    .single();

  if (coErr || !co) return { error: coErr?.message || "Change order not found" };
  if (co.quickbooks_pushed_at) {
    return { error: null, qbEstimateId: co.quickbooks_estimate_id || undefined };
  }
  if (co.status !== "approved" && !co.client_signed_at) {
    return { error: "Only approved or client-signed change orders can be pushed to QuickBooks" };
  }

  const amount = Number(co.price_impact);
  if (!Number.isFinite(amount) || amount === 0) {
    return { error: "Change order has no price impact to push" };
  }

  // Make sure the project exists in QuickBooks as a Job first.
  const projectPush = await pushProjectToQuickBooks(co.project_id);
  if (projectPush.error || !projectPush.qbJobId) {
    return { error: projectPush.error || "Project has no QuickBooks Job" };
  }

  const { accessToken, realmId, environment } = await getValidAccessToken();
  const itemId = await ensureServiceItem(realmId, accessToken, environment);

  const description = `CO #${co.change_order_number} — ${co.title}`;
  const newLine: QBEstimateLine = {
    DetailType: "SalesItemLineDetail",
    Amount: amount,
    Description: description,
    SalesItemLineDetail: { ItemRef: { value: itemId } },
  };

  // Find the job's existing estimate (newest first) and append the CO line.
  const estimates = await qbQuery<QBEstimate>(
    realmId,
    accessToken,
    `SELECT * FROM Estimate WHERE CustomerRef = '${projectPush.qbJobId}' ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 1`,
    environment
  );

  let qbEstimateId: string;
  let appended = false;

  if (estimates[0]) {
    const est = estimates[0];
    // Guard against pushing the same CO line twice if our pushed_at flag was
    // ever cleared — QuickBooks holds the truth.
    const alreadyThere = (est.Line || []).some(
      (l) => (l.Description || "").startsWith(`CO #${co.change_order_number} —`)
    );
    if (!alreadyThere) {
      // Line arrays on update are full-replace: resend every existing line
      // (with their Ids so QuickBooks keeps them) plus the new CO line.
      const keptLines = (est.Line || []).filter(
        (l) => l.DetailType !== "SubTotalLineDetail"
      );
      await qbPost(
        realmId,
        accessToken,
        "Estimate",
        {
          Id: est.Id,
          SyncToken: est.SyncToken,
          sparse: true,
          Line: [...keptLines, newLine],
        },
        environment
      );
    }
    qbEstimateId = est.Id;
    appended = true;
  } else {
    // No estimate on the job yet — create one carrying just this CO.
    const project = Array.isArray(co.projects) ? co.projects[0] : co.projects;
    const docNumber = project?.project_number
      ? `${project.project_number}-CO${co.change_order_number}`.slice(0, 21)
      : undefined;
    const created = await qbPost<QBEstimate>(
      realmId,
      accessToken,
      "Estimate",
      {
        CustomerRef: { value: projectPush.qbJobId },
        DocNumber: docNumber,
        Line: [newLine],
        PrivateNote: `Penney app change order #${co.change_order_number} — ${co.title}`,
      },
      environment
    );
    qbEstimateId = created.Id;
  }

  await supabase
    .from("change_orders")
    .update({
      quickbooks_estimate_id: qbEstimateId,
      quickbooks_pushed_at: new Date().toISOString(),
    })
    .eq("id", co.id);

  return { error: null, qbEstimateId, appended };
}
