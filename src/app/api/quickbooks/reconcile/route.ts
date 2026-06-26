import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/quickbooks/auth";
import { fetchInvoices, fetchPayments } from "@/lib/quickbooks/client";
import { buildReconcilePreview, type AppProject } from "@/lib/quickbooks/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/quickbooks/reconcile
// Read-only dry run: pulls QB invoices + payments, matches them against the
// app's projects, and returns the proposed reconciliation for review.
// Writes NOTHING — the apply step (POST) comes after the user approves.
export async function GET() {
  try {
    const { accessToken, realmId } = await getValidAccessToken();

    const [qbInvoices, qbPayments] = await Promise.all([
      fetchInvoices(realmId, accessToken),
      fetchPayments(realmId, accessToken),
    ]);

    const supabase = createAdminClient();
    const { data: projectRows } = await supabase
      .from("projects")
      .select("id, name, project_number, quickbooks_customer_id, customers(first_name, last_name)");

    const projects: AppProject[] = (projectRows ?? []).map((p) => {
      const c = Array.isArray(p.customers) ? p.customers[0] : p.customers;
      return {
        id: p.id,
        name: p.name,
        project_number: p.project_number,
        quickbooks_customer_id: p.quickbooks_customer_id,
        customer_first_name: c?.first_name ?? null,
        customer_last_name: c?.last_name ?? null,
      };
    });

    const preview = buildReconcilePreview(qbInvoices, qbPayments, projects);

    return NextResponse.json({
      success: true,
      dryRun: true,
      counts: { qbInvoices: qbInvoices.length, qbPayments: qbPayments.length, projects: projects.length },
      ...preview,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Reconcile preview failed" },
      { status: 500 }
    );
  }
}
