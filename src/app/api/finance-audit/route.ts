import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { loadSnapshot, reviewJob } from "@/lib/job-review/service";
import { financialRows } from "@/lib/crew/load-labor-ledger";
import {
  fingerprint,
  sourceRegister,
  type Evidence,
} from "@/lib/job-review/engine";
import { finalAuditReadiness, finalAuditCoverageRequirements } from "@/lib/finance/final-audit";
import { getFinanceWorkspace } from "@/lib/finance/workspace-data";
import { getJobOverheadAllocation } from "@/lib/finance/overhead";

export const maxDuration = 60;
const uuid = z.string().uuid();
const note = z.string().trim().min(20).max(3000);
const money = z.number().int().min(0).max(100_000_000_000);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), project_id: uuid }).strict(),
  z.object({ action: z.literal("prepare"), project_id: uuid }).strict(),
  z
    .object({
      action: z.literal("forecast"),
      project_id: uuid,
      run_id: uuid,
      remaining: money,
      note,
    })
    .strict(),
  z
    .object({
      action: z.literal("finalize"),
      project_id: uuid,
      run_id: uuid,
      closed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      report_file_id: uuid,
      note,
      payroll_burden: money,
      overhead_fingerprint: z.string().min(1).max(256),
      overhead_accepted: z.literal(true),
      attested: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("reopen"),
      project_id: uuid,
      record_id: uuid,
      note,
    })
    .strict(),
]);
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== request.nextUrl.origin)
      return NextResponse.json(
        { error: "Same-origin request required." },
        { status: 403 },
      );
    const user = await getUser();
    if (!user || user.isImpersonating || !canSeeBoardMoney(user.profile?.role))
      return NextResponse.json(
        { error: "Sign in with your own office account." },
        { status: 403 },
      );
    const input = schema.parse(await request.json());
    if (
      !["prepare", "status"].includes(input.action) &&
      !["owner", "precon_manager"].includes(user.profile?.role ?? "")
    )
      return NextResponse.json(
        {
          error:
            "An owner or preconstruction manager must approve forecasts and final audits.",
        },
        { status: 403 },
      );
    if (input.action === "status") {
      const workspace = await getFinanceWorkspace(input.project_id);
      const job = workspace.jobs.find((j) => j.id === input.project_id);
      if (!job) return NextResponse.json({ error: "Project not found." }, { status: 404 });
      return NextResponse.json({ job, canFinalize: workspace.canFinalize, today: workspace.today, auditError: workspace.auditError }, { headers: { "Cache-Control": "no-store" } });
    }
    const db = createAdminClient();
    const actor = user.profile?.full_name || user.email;
    const loadEvidence = async () =>
      (await financialRows((f, t) =>
        db
          .from("job_review_evidence")
          .select("*")
          .eq("project_id", input.project_id)
          .order("id")
          .range(f, t),
      )) as Evidence[];
    if (input.action === "prepare") {
      const review = await reviewJob(user.id, input.project_id);
      const [snapshot, evidence, files, head, overhead] = await Promise.all([
        loadSnapshot(user.id, input.project_id),
        loadEvidence(),
        financialRows((f, t) =>
          db
            .from("project_files")
            .select("id,filename,storage_path")
            .eq("project_id", input.project_id)
            .order("id")
            .range(f, t),
        ),
        db
          .from("project_finance_records")
          .select("id,kind,created_at")
          .eq("project_id", input.project_id)
          .neq("kind", "forecast")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        getJobOverheadAllocation(input.project_id),
      ]);
      if (head.error)
        throw new Error(
          "Audit history unavailable. Apply the finance migration before finalizing.",
        );
      const readiness = finalAuditReadiness(snapshot, evidence);
      return NextResponse.json(
        {
          review,
          blockers: [...readiness.blockers, ...overhead.blockers],
          coverageRequirements: finalAuditCoverageRequirements(snapshot),
          overhead,
          files: files.filter((f) => f.storage_path),
          head: head.data,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (input.action === "reopen") {
      const result = await db.rpc("append_project_finance_record", {
        p_actor: user.id,
        p_project: input.project_id,
        p_kind: "reopen",
        p_run: null,
        p_expected_head: input.record_id,
        p_closed_on: null,
        p_payload: { note: input.note },
        p_evidence: null,
      });
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ id: result.data });
    }
    const [snapshot, evidence, run, head] = await Promise.all([
      loadSnapshot(user.id, input.project_id),
      loadEvidence(),
      db
        .from("job_review_runs")
        .select("id,fingerprint,checked_at")
        .eq("id", input.run_id)
        .eq("project_id", input.project_id)
        .eq("actor_id", user.id)
        .single(),
      db
        .from("project_finance_records")
        .select("id,kind")
        .eq("project_id", input.project_id)
        .neq("kind", "forecast")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (run.error || !run.data || head.error)
      throw new Error("Reload the audit preview before saving.");
    if (head.data?.kind === "final")
      throw new Error(
        "Reopen the final audit before changing the forecast or final P&L.",
      );
    if (
      Date.now() - Date.parse(run.data.checked_at) > 30 * 60_000 ||
      fingerprint(sourceRegister(snapshot)) !== run.data.fingerprint
    )
      throw new Error(
        "Project records changed or the preview expired. Refresh and check the new numbers.",
      );
    const { review, blockers } = finalAuditReadiness(snapshot, evidence);
    const workspace = await getFinanceWorkspace(input.project_id);
    const job = workspace.jobs.find((j) => j.id === input.project_id);
    if (!job || workspace.auditError)
      throw new Error("Project financial history unavailable.");
    if (
      job.cost !== review.money.recorded_cost ||
      job.contract !== review.money.contract
    )
      throw new Error(
        "Project totals changed during review. Refresh the preview.",
      );
    const common = {
      contract: review.money.contract,
      cost: review.money.recorded_cost,
      budget: review.money.cost_budget,
      hours: review.money.net_minutes / 60,
      note: input.note,
      review_id: input.run_id,
      financial_basis: job.financialBasis,
    };
    let payload: Record<string, unknown> = { ...common };
    let closedOn: string | null = null;
    if (input.action === "forecast") {
      if (input.remaining < review.money.known_unbilled_commitments)
        throw new Error(
          "Remaining cost must include the known unbilled commitments.",
        );
      payload = { ...payload, remaining: input.remaining };
    } else {
      // The client accepts a displayed basis; it cannot submit its own overhead amount.
      const overhead = await getJobOverheadAllocation(input.project_id);
      if (overhead.fingerprint !== input.overhead_fingerprint)
        throw new Error("Company overhead or receipts changed. Refresh the audit and review the new allocation.");
      if (overhead.blockers.length || overhead.allocated === null)
        throw new Error(`Overhead allocation is not ready: ${overhead.blockers.join(" ")}`);
      if (blockers.length)
        throw new Error(
          `Final audit is blocked: ${blockers.slice(0, 3).join(" ")}`,
        );
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      if (
        input.closed_on > today ||
        new Date(`${input.closed_on}T12:00:00Z`).toISOString().slice(0, 10) !==
          input.closed_on
      )
        throw new Error("Choose a valid closing date on or before today.");
      const file = snapshot.records.project_files.find(
        (f) => f.id === input.report_file_id,
      );
      const version = snapshot.records.storage_objects.find(
        (o) =>
          o.path === file?.storage_path &&
          o.bucket === (file?.storage_bucket || "project-files") &&
          o.available &&
          (o.version || o.etag),
      );
      if (!file || !version)
        throw new Error(
          "Choose an accessible, versioned final audit report from this project's Files.",
        );
      const finalCost =
        review.money.recorded_cost +
        input.payroll_burden +
        overhead.allocated;
      const profit = review.money.contract! - finalCost;
      payload = {
        ...payload,
        final_cost: finalCost,
        payroll_burden: input.payroll_burden,
        allocated_overhead: overhead.allocated,
        overhead_allocation: overhead,
        gross_profit: review.money.contract! - review.money.recorded_cost - input.payroll_burden,
        profit,
        margin: review.money.contract ? profit / review.money.contract : null,
        report_file_id: file.id,
        report_name: file.filename,
        report_version: version,
        scopes: review.scopes,
        received: review.money.received,
        collections: review.collections,
        source_register: sourceRegister(snapshot),
        evidence,
        attestation:
          "Reviewer confirmed completion, final costs, payroll burden, permits/inspections, allowance reconciliation, client acceptance and the disposition of remaining receivables/payables against the saved report; accepted allocating recorded monthly company overhead by this job's share of net recorded receipts.",
      };
      closedOn = input.closed_on;
    }
    const result = await db.rpc("append_project_finance_record", {
      p_actor: user.id,
      p_project: input.project_id,
      p_kind: input.action === "forecast" ? "forecast" : "final",
      p_run: input.run_id,
      p_expected_head: head.data?.id ?? null,
      p_closed_on: closedOn,
      p_payload: payload,
      p_evidence: evidence,
    });
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ id: result.data, actor });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Check the required audit fields."
            : error instanceof Error
              ? error.message
              : "Audit could not be saved.",
      },
      { status: 409 },
    );
  }
}
