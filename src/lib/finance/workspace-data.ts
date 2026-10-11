import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/auth/require-auth";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { financialRows, loadLaborLedger } from "@/lib/crew/load-labor-ledger";
import { pickCurrentEstimate } from "@/lib/estimates/current";
import { lineCost } from "@/lib/estimates/line-item-financials";
import { fingerprint } from "@/lib/job-review/engine";
import { buildOpenBills, type BillRecord } from "./open-bills";
import {
  cents,
  total,
  latestRecords,
  collectionBalance,
  type ProjectHealth,
  type FinanceRecord,
  type CollectionRow,
} from "./workspace-model";

export const getFinanceWorkspace = cache(async () => {
  const user = await requireAuth();
  if (!canSeeBoardMoney(user.profile?.role))
    throw new Error("Office financial access required.");
  const db = await createClient();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [
    projects,
    bills,
    receipts,
    invoices,
    estimates,
    lines,
    changes,
    labor,
    reviews,
    recordResult,
  ] = await Promise.all([
    financialRows((f, t) =>
      db
        .from("projects")
        .select(
          "id,name,project_number,status,is_overhead,actual_end_date,contract_locked_amount,contract_value,contract_estimate_id",
        )
        .order("id")
        .range(f, t),
    ),
    financialRows((f, t) =>
      db
        .from("invoices")
        .select(
          "id,project_id,amount,paid_amount,payment_status,payment_method,source,review_status,review_reason,duplicate_of_id,estimate_line_item_id,vendor_name,invoice_number,invoice_date,due_date,split_group_id,pay_approval_status,approved_for_pay_at,description,projects(name,project_number)",
        )
        .is("duplicate_of_id", null)
        .order("id")
        .range(f, t),
    ),
    financialRows((f, t) =>
      db
        .from("payments_received")
        .select("id,project_id,client_invoice_id,amount")
        .order("id")
        .range(f, t),
    ),
    financialRows((f, t) =>
      db
        .from("client_invoices")
        .select(
          "id,project_id,invoice_number,title,amount,paid_amount,status,sent_to_client_at,due_date",
        )
        .order("id")
        .range(f, t),
    ),
    financialRows((f, t) =>
      db
        .from("estimates")
        .select("id,project_id,version,status")
        .order("version", { ascending: false })
        .order("id")
        .range(f, t),
    ),
    financialRows((f, t) =>
      db
        .from("estimate_line_items")
        .select("id,estimate_id,cost,total_cost,is_section_header")
        .order("id")
        .range(f, t),
    ),
    financialRows((f, t) =>
      db
        .from("change_orders")
        .select("id,project_id,status,price_impact")
        .eq("status", "approved")
        .order("id")
        .range(f, t),
    ),
    loadLaborLedger(db),
    // Saved review snapshots are service-only. After the office gate above,
    // expose only their project/date index, never raw source registers.
    financialRows((f, t) =>
      createAdminClient()
        .from("job_review_runs")
        .select("id,project_id,checked_at")
        .order("checked_at", { ascending: false })
        .order("id")
        .range(f, t),
    ),
    financialRows((f, t) =>
      db
        .from("project_finance_records")
        .select("id,project_id,kind,created_at,actor_name,closed_on,payload")
        .order("created_at", { ascending: false })
        .order("id")
        .range(f, t),
    )
      .then((data) => ({ data, error: null as string | null }))
      .catch(() => ({
        data: [],
        error:
          "Saved audit history could not load. Finalization is unavailable until it loads.",
      })),
  ]);
  const records = recordResult.data as FinanceRecord[];
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const collections: CollectionRow[] = invoices.flatMap((i) => {
    const result = collectionBalance(
      i,
      receipts.filter((r) => r.client_invoice_id === i.id),
    );
    if (!result || (!result.balance && !result.issue)) return [];
    return [
      {
        id: i.id,
        projectId: i.project_id,
        projectName: names.get(i.project_id) ?? "Unknown project",
        number: i.invoice_number,
        title: i.title,
        amount: cents(i.amount) ?? 0,
        balance: result.balance,
        due: i.due_date,
        daysLate: i.due_date
          ? Math.max(
              0,
              Math.floor(
                (Date.parse(today) - Date.parse(i.due_date)) / 86400000,
              ),
            )
          : 0,
        issue: result.issue,
      },
    ];
  });
  const jobs: ProjectHealth[] = projects
    .filter((p) => !p.is_overhead)
    .map((p) => {
      const jobBills = bills.filter((b) => b.project_id === p.id),
        shifts = labor.rows.filter(
          (l) => l.project_id === p.id && l.rawMinutes > 0,
        );
      const estimate = pickCurrentEstimate(
        estimates.filter((e) => e.project_id === p.id),
        p.contract_estimate_id,
      );
      const budgetLines = lines.filter(
        (l) => l.estimate_id === estimate?.id && !l.is_section_header,
      );
      const budget =
        estimate &&
        budgetLines.length &&
        budgetLines.every((l) => l.cost != null || l.total_cost != null)
          ? total(budgetLines, (l) => Math.round(lineCost(l) * 100))
          : null;
      const base = cents(p.contract_locked_amount ?? p.contract_value),
        co = changes.filter((c) => c.project_id === p.id);
      const contract =
        base === null || co.some((c) => cents(c.price_impact) === null)
          ? null
          : base + total(co, (c) => cents(c.price_impact) ?? 0);
      const vendorCost = total(jobBills, (b) => cents(b.amount) ?? 0),
        laborCost = total(shifts, (l) => l.projectCostCents),
        cost = vendorCost + laborCost;
      const received = total(
        receipts.filter((r) => r.project_id === p.id),
        (r) => cents(r.amount) ?? 0,
      );
      const { audit, forecast } = latestRecords(
        records.filter((r) => r.project_id === p.id),
      );
      const financialBasis = fingerprint({
        project: p,
        bills: jobBills,
        shifts,
        budgetLines,
        changes: co,
        receipts: receipts.filter((r) => r.project_id === p.id),
        invoices: invoices.filter((r) => r.project_id === p.id),
      });
      const warnings: string[] = [];
      if (contract === null)
        warnings.push("Contract amount needs verification");
      if (budget === null) warnings.push("Cost budget missing or incomplete");
      if (jobBills.some((b) => cents(b.amount) === null))
        warnings.push("Bill amount missing");
      if (
        jobBills.some(
          (b) =>
            b.review_status !== "ok" ||
            !budgetLines.some((l) => l.id === b.estimate_line_item_id),
        )
      )
        warnings.push("Bills need source or budget-line review");
      if (jobBills.some((b) => /^(qb(?:_|$)|quickbooks)/i.test(b.source ?? "")))
        warnings.push("Imported costs need Penney source verification");
      if (shifts.some((l) => l.rate === null))
        warnings.push("Missing crew pay rate");
      if (shifts.some((l) => l.open))
        warnings.push("Live crew hours are provisional");
      if (collections.some((i) => i.projectId === p.id && i.issue))
        warnings.push("Client receipts need reconciliation");
      const ownCollections = collections.filter(
        (i) => i.projectId === p.id && !i.issue,
      );
      return {
        id: p.id,
        name: p.name,
        number: p.project_number ?? "",
        status: p.status,
        closedOn: p.actual_end_date,
        contract,
        budget,
        vendorCost,
        laborCost,
        cost,
        hours: total(shifts, (l) => l.paidMinutes) / 60,
        received,
        outstanding: total(ownCollections, (i) => i.balance),
        overdue: total(
          ownCollections.filter((i) => i.daysLate > 0),
          (i) => i.balance,
        ),
        warnings,
        reviewDate:
          reviews.find((r) => r.project_id === p.id)?.checked_at ?? null,
        audit,
        forecast,
        financialBasis,
        finalNeedsReview:
          audit?.kind === "final" &&
          (audit.payload.cost !== cost ||
            audit.payload.contract !== contract ||
            audit.payload.financial_basis !== financialBasis),
      };
    });
  return {
    today,
    jobs,
    collections,
    records,
    auditError: recordResult.error,
    bills: buildOpenBills(bills as BillRecord[], today),
    canFinalize:
      !user.isImpersonating &&
      ["owner", "precon_manager"].includes(user.profile?.role ?? ""),
  };
});
