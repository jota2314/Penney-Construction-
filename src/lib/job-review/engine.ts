import { createHash } from "node:crypto";
import { calculateLabor, type ClockRow, type LaborEmployee, type RateChange, type BreakAdjustment } from "../crew/labor-ledger";
import { pickCurrentEstimate } from "../estimates/current";
import { lineCost, type LineFinancialsRow } from "../estimates/line-item-financials";

// Database rows stay in the server-side source register. The public result is
// intentionally small and never includes signatures, access tokens or pay rates.
export type Row = Record<string, unknown> & { id: string };
export type Snapshot = { as_of: string; records: Record<string, Row[]> };
export type Evidence = { id: string; title: string; action: string; classification: "allocation_question" | "verified_cost" | "question"; line_id: string | null; refs: Record<string, string>; reviewed_at: string; resolved: boolean; priority?: number; supersedes_id?: string | null };
export type Scope = { id: string; name: string; budget: number | null; vendor_cost: number; wages: number; cost: number; minutes: number; unbilled_commitment: number; bill_ids: string[]; shift_ids: string[] };
export type Finding = { id: string; kind: string; title: string; detail: string; action: string; line_id: string | null; amount: number | null; refs: string[]; evidence_state: string };
export const ENGINE_VERSION = "1.0.0";
const str = (v: unknown) => typeof v === "string" ? v : "";
const vendorKey = (v: unknown) => str(v).toLowerCase().replace(/\b(inc|llc|corp|corporation|incorporated)\b/g, "").replace(/[^a-z0-9]/g, "");
const money = (v: unknown): number | null => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100);
const sum = <T>(a: T[], f: (r: T) => number) => a.reduce((s, r) => s + f(r), 0);
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v !== null && typeof v === "object" ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}` : JSON.stringify(v) ?? "null";
export const fingerprint = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
export function sourceRegister(s: Snapshot) {
  return Object.fromEntries(Object.entries(s.records).flatMap(([source, rows]) => rows.map(r => [`${source}:${r.id}`, fingerprint(r)])));
}
export function changesSince(current: Record<string, string>, previous: Record<string, string> = {}) {
  return { added: Object.keys(current).filter(k => !(k in previous)), changed: Object.keys(current).filter(k => k in previous && current[k] !== previous[k]), removed: Object.keys(previous).filter(k => !(k in current)), unchanged: Object.keys(current).filter(k => current[k] === previous[k]).length };
}
export function costEvidenceDependencies(snapshot: Snapshot, scope: Scope) {
  const refs = [`lines:${scope.id}`, `projects:${snapshot.records.projects[0].id}`];
  for (const id of scope.bill_ids) {
    refs.push(`invoices:${id}`);
    const bill = snapshot.records.invoices.find(b => b.id === id)!;
    const docs = snapshot.records.storage_objects?.filter(o => o.path === bill.attachment_storage_path && o.available && (o.version || o.etag)) ?? [];
    if (!docs.length) throw new Error(`Bill ${id} needs an accessible, versioned original before its costs can be marked verified.`);
    refs.push(...docs.map(d => `storage_objects:${d.id}`));
  }
  if (scope.shift_ids.length) for (const source of ["all_day_shifts", "employees", "rates", "breaks", "schedule_phases"]) refs.push(...snapshot.records[source].map(r => `${source}:${r.id}`));
  return refs;
}
export function calculateReview(snapshot: Snapshot, evidence: Evidence[] = []) {
  const rows = (key: string) => {
    if (!Array.isArray(snapshot.records[key])) throw new Error(`Incomplete review: ${key} did not load.`);
    return snapshot.records[key];
  };
  const project = rows("projects")[0];
  if (!project) throw new Error("Project not found.");
  const register = sourceRegister(snapshot);
  const replaced = new Set(evidence.map(e => e.supersedes_id).filter(Boolean));
  const notes = evidence.filter(e => !replaced.has(e.id)).sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2) || a.reviewed_at.localeCompare(b.reviewed_at) || a.title.localeCompare(b.title)).map(e => ({ ...e, current: Object.keys(e.refs).length > 0 && Object.entries(e.refs).every(([k, hash]) => register[k] === hash) }));
  const estimate = pickCurrentEstimate(rows("estimates").sort((a, b) => Number(b.version) - Number(a.version)), str(project.contract_estimate_id));
  const lines = rows("lines").filter(l => l.estimate_id === estimate?.id && !l.is_section_header);
  const scopes: Scope[] = lines.map(l => ({ id: l.id, name: str(l.description), budget: l.cost == null && l.total_cost == null ? null : money(lineCost(l as LineFinancialsRow)), vendor_cost: 0, wages: 0, cost: 0, minutes: 0, unbilled_commitment: 0, bill_ids: [], shift_ids: [] }));
  const unallocated: Scope = { id: "unallocated", name: "Unallocated / older estimate", budget: null, vendor_cost: 0, wages: 0, cost: 0, minutes: 0, unbilled_commitment: 0, bill_ids: [], shift_ids: [] };
  scopes.push(unallocated);
  const byLine = new Map(scopes.map(l => [l.id, l]));
  const findings: Finding[] = [];
  const gaps: string[] = [];
  const bills = rows("invoices").filter(b => !b.duplicate_of_id);
  for (const b of bills) {
    const scope = byLine.get(str(b.estimate_line_item_id)) ?? unallocated;
    const amount = money(b.amount);
    if (amount === null) gaps.push(`Bill ${b.id} has no usable amount.`);
    scope.vendor_cost += amount ?? 0;
    scope.bill_ids.push(b.id);
    if (b.review_status && b.review_status !== "ok") findings.push({ id: `bill:${b.id}`, kind: "allocation_question", title: `${str(b.vendor_name)} needs review`, detail: str(b.review_reason) || str(b.help_note) || "This bill has not passed the app's spending review.", action: "Check the original bill and its job/scope allocation.", line_id: scope.id, amount, refs: [`invoices:${b.id}`], evidence_state: "unverified" });
  }
  const phases = rows("schedule_phases");
  const phaseById = new Map(phases.map(p => [p.id, p]));
  const clock = rows("all_day_shifts").map(l => ({ ...l, project_id: l.project_id ?? phaseById.get(str(l.schedule_phase_id))?.project_id ?? null })) as unknown as (ClockRow & Row)[];
  const labor = calculateLabor(clock, rows("employees") as unknown as LaborEmployee[], rows("rates") as unknown as RateChange[], rows("breaks") as unknown as BreakAdjustment[], new Set(project.labor_cost_source === "ledger" ? [project.id] : []), Date.parse(snapshot.as_of), new Map(project.labor_ledger_through ? [[project.id, str(project.labor_ledger_through)]] : []))
    .filter(l => l.project_id === project.id && l.rawMinutes > 0);
  for (const l of labor) {
    const scope = byLine.get(str(l.estimate_line_item_id ?? phaseById.get(str(l.schedule_phase_id))?.estimate_line_item_id)) ?? unallocated;
    scope.wages += l.projectCostCents;
    scope.minutes += l.paidMinutes;
    scope.shift_ids.push(l.id);
    if (l.rate === null) gaps.push(`Missing historical wage for shift ${l.id}; recorded cost is a lower bound.`);
    if (l.open) gaps.push(`Shift ${l.id} is still open; wages are provisional.`);
  }
  for (const q of rows("quotes").filter(q => q.status === "accepted")) {
    const scope = byLine.get(str(q.estimate_line_item_id)) ?? unallocated;
    const value = money(q.amount);
    const linked = bills.filter(b => b.quote_request_id === q.id);
    const unresolvedMatch = bills.some(b => !b.quote_request_id && (
      (q.subcontractor_id && b.subcontractor_id === q.subcontractor_id) ||
      (q.estimate_line_item_id && b.estimate_line_item_id === q.estimate_line_item_id) ||
      (q.subcontractor_name && vendorKey(b.vendor_name) === vendorKey(q.subcontractor_name)) ||
      (q.trade && str(b.trade).toLowerCase() === str(q.trade).toLowerCase())
    ));
    if (value === null) gaps.push(`Accepted quote ${q.id} has no amount.`);
    else if (unresolvedMatch && value > sum(linked, b => money(b.amount) ?? 0)) {
      gaps.push(`Accepted quote ${q.id} may already be billed; its unlinked bills must be reconciled before counting a remaining commitment.`);
      findings.push({ id: `commitment:${q.id}`, kind: "question", title: `${str(q.subcontractor_name) || scope.name}: check quote/bill match`, detail: "Potentially matching bills have no explicit quote link. Do not count the quote again as remaining cost.", action: "Match the accepted quote and bill scope; establish only the unbilled remainder.", line_id: scope.id, amount: null, refs: [`quotes:${q.id}`, ...scope.bill_ids.map(id => `invoices:${id}`)], evidence_state: "unverified" });
    } else scope.unbilled_commitment += Math.max(0, value - sum(linked, b => money(b.amount) ?? 0));
  }
  if (rows("material_orders").some(r => !["cancelled", "rejected"].includes(str(r.status)))) gaps.push("Material orders need a remaining-cost check; order status alone does not establish unbilled dollars.");
  if (rows("material_returns").some(r => r.status !== "cancelled")) gaps.push("Verify return credits against booked bills; a return request is not a received credit.");
  if (rows("time_entries").length) gaps.push("Additional time entries exist; reconcile them with clocked/ledger labor before final profit.");
  if (rows("job_ledger_entries").length) gaps.push("Separate ledger entries exist; reconcile their overlap with bills before final profit.");
  for (const s of scopes) {
    s.cost = s.vendor_cost + s.wages;
    const related = notes.filter(n => n.line_id === s.id && (!n.resolved || !n.current));
    const disputed = related.some(n => n.classification === "allocation_question") || findings.some(f => f.line_id === s.id && f.kind === "allocation_question");
    let verified = false;
    if (!disputed && s.id !== "unallocated") {
      try { const required = costEvidenceDependencies(snapshot, s); verified = related.some(n => n.classification === "verified_cost" && n.current && required.every(k => k in n.refs)); }
      catch { /* An inaccessible/unversioned original cannot establish verified cost. */ }
    }
    const refs = [...s.bill_ids.map(id => `invoices:${id}`), ...s.shift_ids.map(id => `all_day_shifts:${id}`), ...(s.id === "unallocated" ? [] : [`lines:${s.id}`])];
    if ((s.budget === null || s.budget <= 0) && s.cost > 0) findings.push({ id: `budget:${s.id}`, kind: s.id === "unallocated" ? "allocation_question" : "missing_budget", title: s.name, detail: s.id === "unallocated" ? "Costs have no line on the current estimate." : "Cost is recorded against a zero or missing cost budget; an overrun percentage would be misleading.", action: s.id === "unallocated" ? "Verify the job and scope before assigning these costs." : "Check the approved cost allowance and change-order budget.", line_id: s.id, amount: s.cost, refs, evidence_state: "recorded" });
    else if (s.budget !== null && s.cost > s.budget) findings.push({ id: `over:${s.id}`, kind: disputed ? "allocation_question" : "cost_overrun", title: s.name, detail: disputed ? "Above budget as recorded; the allocation is disputed." : verified ? "Above cost budget; supporting evidence is current." : "Above cost budget in the records; source and allocation verification remains required.", action: disputed ? "Resolve the allocation with source evidence before calling this a true overrun." : "Check the supporting bills, scope and remaining work.", line_id: s.id, amount: s.cost - s.budget, refs, evidence_state: verified ? "verified" : "recorded" });
    else if (s.budget !== null && s.cost + s.unbilled_commitment > s.budget) findings.push({ id: `forecast:${s.id}`, kind: "forecast_risk", title: s.name, detail: "Recorded costs plus the unbilled portion of accepted quotes exceed cost budget. This is not a booked overrun.", action: "Confirm linked bills and remaining committed scope.", line_id: s.id, amount: s.cost + s.unbilled_commitment - s.budget, refs, evidence_state: "forecast" });
  }
  for (const n of notes.filter(n => !n.resolved || !n.current)) findings.push({ id: `evidence:${n.id}`, kind: n.classification, title: n.title, detail: n.current ? `Evidence reviewed ${n.reviewed_at}; still open.` : "Supporting records changed or disappeared; the prior finding needs rechecking.", action: n.action, line_id: n.line_id, amount: null, refs: Object.keys(n.refs), evidence_state: n.current ? "carried_forward" : "stale" });
  const contractBase = money(project.contract_locked_amount ?? project.contract_value);
  const approved = rows("change_orders").filter(c => c.status === "approved");
  if (approved.some(c => money(c.price_impact) === null)) gaps.push("An approved change order is missing its price impact.");
  const contract = contractBase === null ? null : contractBase + sum(approved, c => money(c.price_impact) ?? 0);
  const receipts = rows("payments_received");
  if (receipts.some(r => money(r.amount) === null)) gaps.push("A recorded receipt is missing its amount.");
  const received = sum(receipts, r => money(r.amount) ?? 0);
  const today = new Date(snapshot.as_of).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const sentInvoices = rows("client_invoices").filter(i => i.sent_to_client_at && !["void", "voided", "cancelled", "draft"].includes(str(i.status)));
  const collections = sentInvoices.map(i => {
    const linked = sum(receipts.filter(r => r.client_invoice_id === i.id), r => money(r.amount) ?? 0);
    const recordedPaid = money(i.paid_amount) ?? 0;
    if (linked && linked !== recordedPaid) gaps.push(`Invoice #${i.invoice_number}: linked receipts and paid amount differ; reconcile before collecting.`);
    const remaining = Math.max(0, (money(i.amount) ?? 0) - Math.max(linked, recordedPaid));
    return { id: i.id, number: i.invoice_number, title: str(i.title), remaining, due_date: str(i.due_date) || null, overdue: remaining > 0 && !!i.due_date && str(i.due_date) < today };
  });
  const recordedStage = str(project.status);
  const finalInvoice = sentInvoices.find(i => /\bfinal\b/i.test(str(i.title)));
  const closeout = ["audit", "complete", "completed", "closed", "closeout"].includes(recordedStage) || !!finalInvoice;
  const stage = closeout ? "Closeout — completion needs verification" : recordedStage === "active" || labor.length ? "Work underway" : "Stage needs confirmation";
  const cost = sum(scopes, s => s.cost);
  if (cost !== sum(bills, b => money(b.amount) ?? 0) + sum(labor, l => l.projectCostCents)) throw new Error("Scope totals did not reconcile.");
  const activePhases = phases.filter(p => ["in_progress", "active"].includes(str(p.status))).map(p => ({ id: p.id, name: str(p.name), status: str(p.status) }));
  const fieldDates = [...rows("daily_logs"), ...rows("field_report_notes"), ...rows("field_report_photos")].map(r => str(r.started_at ?? r.report_date ?? r.created_at)).filter(Boolean).sort();
  const next = [...new Set([
    ...(notes.filter(n => !n.resolved || !n.current).map(n => n.action)),
    ...findings.filter(f => ["allocation_question", "missing_budget", "cost_overrun"].includes(f.kind)).map(f => `${f.title}: ${f.action}`),
    ...(closeout ? ["Confirm remaining work, final vendor bills, permits/inspections and client acceptance before closing."] : ["Confirm current work, blockers and the next phase with recent field evidence."]),
  ])].slice(0, 3);
  return {
    engine_version: ENGINE_VERSION, as_of: snapshot.as_of,
    project: { id: project.id, name: str(project.name), number: str(project.project_number) },
    stage: { label: stage, basis: finalInvoice ? "Recorded job status and a sent invoice titled final; neither proves physical completion." : `Recorded status: ${recordedStage || "unknown"}.`, active_phases: activePhases, last_field_date: fieldDates.at(-1) ?? null, percent_complete: null },
    money: { cost_budget: estimate && !scopes.slice(0, -1).some(s => s.budget === null) ? sum(scopes, s => s.budget ?? 0) : null, recorded_cost: cost, vendor_cost: sum(scopes, s => s.vendor_cost), modeled_wages: sum(scopes, s => s.wages), net_minutes: sum(scopes, s => s.minutes), known_unbilled_commitments: sum(scopes, s => s.unbilled_commitment), contract, received, contract_remaining: contract === null ? null : contract - received, final_profit: null, remaining_cost: null, cost_is_lower_bound: gaps.length > 0 },
    collections, scopes, findings, next_actions: next,
    coverage: { status: "partial" as const, explanation: "Current records reconciled. Final profit awaits remaining costs, source-document/field verification and payroll burden. Recorded receipts do not prove bank clearing.", gaps: [...new Set(gaps)], sources: Object.fromEntries(Object.entries(snapshot.records).map(([k, v]) => [k, v.length])), evidence_current: notes.filter(n => n.current).length, evidence_stale: notes.filter(n => !n.current).length },
  };
}
export type JobReview = ReturnType<typeof calculateReview> & { run_id: string; changes: ReturnType<typeof changesSince>; elapsed_ms: number };
