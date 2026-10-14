import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { canSeeBoardMoney } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSnapshot } from "@/lib/job-review/service";
import { fingerprint } from "@/lib/job-review/engine";
import type { OverheadAllocation } from "@/lib/finance/overhead-allocation";

const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (v: unknown) =>
  v == null
    ? "Not verified"
    : (Number(v) / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user || !canSeeBoardMoney(user.profile?.role))
    return new NextResponse("Office financial access required", {
      status: 403,
    });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return new NextResponse("Invalid audit", { status: 400 });
  const db = await createClient();
  const { data: r, error } = await db
    .from("project_finance_records")
    .select("*,projects(name,project_number)")
    .eq("id", id)
    .eq("kind", "final")
    .single();
  if (error || !r)
    return new NextResponse("Final audit not found", { status: 404 });
  const p = r.payload;
  if (request.nextUrl.searchParams.get("source") === "1") {
    if (user.isImpersonating)
      return new NextResponse("Use your own account to open source evidence", {
        status: 403,
      });
    const snapshot = await loadSnapshot(user.id, r.project_id);
    const saved = p.report_version;
    const current = snapshot.records.storage_objects.find(
      (o) => o.id === saved?.id,
    );
    if (!current || fingerprint(current) !== fingerprint(saved))
      return new NextResponse(
        "The report source changed since finalization. The frozen P&L is preserved; review the source revision in project Files.",
        { status: 409 },
      );
    const signed = await createAdminClient()
      .storage.from(String(saved.bucket))
      .createSignedUrl(String(saved.path), 300);
    if (!signed.data?.signedUrl)
      return new NextResponse("Source unavailable", { status: 409 });
    return NextResponse.redirect(signed.data.signedUrl);
  }
  const scopes = Array.isArray(p.scopes)
    ? (p.scopes as {
        name: string;
        budget: number | null;
        vendor_cost: number;
        wages: number;
        cost: number;
        minutes: number;
      }[])
    : [];
  const overhead = p.overhead_allocation as OverheadAllocation | undefined;
  const overheadDetail = overhead?.method === "monthly_net_receipts"
    ? `<h2>Actual company overhead allocation</h2><p>For each month: recorded company overhead × job net receipts ÷ company net receipts. The reviewer accepted this allocation basis at closeout. Payroll splits, eligible overhead bills and signed receipt entries are retained by source fingerprint.</p><div class="scroll"><table><thead><tr><th>Month</th><th>Company overhead</th><th>Company receipts</th><th>Job receipts</th><th>Job overhead</th></tr></thead><tbody>${overhead.months.map(m => `<tr><td>${escape(m.month)}</td><td>${escape(money(m.overhead))}</td><td>${escape(money(m.companyReceipts))}</td><td>${escape(money(m.jobReceipts))}</td><td>${escape(money(m.allocated))}</td></tr>`).join("")}</tbody></table></div><small>Allocation fingerprint ${escape(overhead.fingerprint)} · ${Object.keys(overhead.source_register).length} retained source fingerprints.</small>`
    : "<p>See the source report for the approved overhead basis.</p>";
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(r.projects?.name)} · Final P&amp;L</title><style>body{font:16px/1.6 system-ui;color:#192923;background:#f6f7f3;margin:0}main{max-width:1050px;margin:40px auto;padding:32px;background:white;border:1px solid #dbe2db;border-radius:16px}h1{line-height:1.15}small{color:#647168}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:right;padding:10px;border-bottom:1px solid #e2e8e2}td:first-child,th:first-child{text-align:left}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}.card{background:#f0f5f0;padding:16px;border-radius:10px}.value{display:block;font-size:24px;font-weight:650}.scroll{overflow:auto}a{color:#286846}@media print{body{background:white}main{margin:0;border:0;padding:0}a{display:none}}</style><main><small>PENNEY CONSTRUCTION · FINAL PROJECT P&amp;L</small><h1>${escape(r.projects?.name)}</h1><p>${escape(r.projects?.project_number)} · Closed ${escape(r.closed_on)} · Approved by ${escape(r.actor_name)} on ${escape(r.created_at.slice(0, 10))}</p><div class="grid">${[
    ["Final revenue", p.contract],
    ["Total final cost", p.final_cost],
    ["Final net profit", p.profit],
  ]
    .map(
      ([label, v]) =>
        `<div class="card">${escape(label)}<span class="value">${escape(money(v))}</span></div>`,
    )
    .join("")}</div><h2>Final cost reconciliation</h2><table>${[
    ["Recorded vendor costs and wages", p.cost],
    ["Additional payroll burden", p.payroll_burden],
    ["Allocated actual company overhead", p.allocated_overhead],
    ["Total final cost", p.final_cost],
  ]
    .map(
      ([label, v]) =>
        `<tr><td>${escape(label)}</td><td>${escape(money(v))}</td></tr>`,
    )
    .join(
      "",
    )}</table><p>Net profit margin: ${p.margin == null ? "Not verified" : escape((Number(p.margin) * 100).toFixed(2) + "%")}.</p>${overheadDetail}<h2>Scope and crew hours</h2><div class="scroll"><table><thead><tr><th>Scope</th><th>Budget</th><th>Vendor cost</th><th>Modeled wages</th><th>Recorded cost</th><th>Hours</th></tr></thead><tbody>${scopes.map((s) => `<tr><td>${escape(s.name)}</td><td>${escape(money(s.budget))}</td><td>${escape(money(s.vendor_cost))}</td><td>${escape(money(s.wages))}</td><td>${escape(money(s.cost))}</td><td>${(s.minutes / 60).toFixed(1)}</td></tr>`).join("")}</tbody></table></div><h2>Reviewer’s approval</h2><p>${escape(p.note)}</p><p>${escape(p.attestation)}</p><p>Recorded receipts at finalization: ${escape(money(p.received))}. Profit is separate from cash collection. Company overhead outside the stated allocation remains excluded.</p><p><a href="?source=1">Open version-checked source report: ${escape(p.report_name)}</a></p><small>Immutable audit ${escape(r.id)} · Saved review ${escape(r.review_id)}. This report retains the approved closing-period figures even if later records change or the audit is reopened.</small></main></html>`;
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
