import { createAdminClient } from "../supabase/admin";
import { calculateReview, changesSince, costEvidenceDependencies, ENGINE_VERSION, fingerprint, sourceRegister, type Evidence, type JobReview, type Snapshot } from "./engine";

const db = () => createAdminClient();
export async function loadSnapshot(actor: string, project: string): Promise<Snapshot> {
  const { data, error } = await db().rpc("job_review_snapshot", { p_actor_id: actor, p_project_id: project });
  if (error || !data) throw new Error(error?.message ?? "Review inventory unavailable.");
  return data as Snapshot;
}
async function loadEvidence(project: string): Promise<Evidence[]> {
  // JSON aggregation in the snapshot avoids PostgREST's row limit. Evidence is
  // explicitly paginated too; failing any page must fail the review.
  const all: Evidence[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from("job_review_evidence").select("*").eq("project_id", project).order("id").range(from, from + 999);
    if (error || !data) throw new Error(error?.message ?? "Prior evidence unavailable.");
    all.push(...data as Evidence[]);
    if (data.length < 1000) return all;
  }
}
export async function reviewJob(actor: string, project: string): Promise<JobReview> {
  const start = Date.now();
  const [snapshot, evidence, previous] = await Promise.all([
    loadSnapshot(actor, project), loadEvidence(project),
    db().from("job_review_runs").select("source_register").eq("project_id", project).order("checked_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (previous.error) throw new Error(previous.error.message);
  const register = sourceRegister(snapshot);
  const result = calculateReview(snapshot, evidence);
  const changes = changesSince(register, previous.data?.source_register);
  const { data, error } = await db().from("job_review_runs").insert({ project_id: project, actor_id: actor, checked_at: snapshot.as_of, engine_version: ENGINE_VERSION, fingerprint: fingerprint(register), source_register: register, snapshot, result: { ...result, changes } }).select("id").single();
  if (error || !data) throw new Error(`Review calculated but could not save: ${error?.message}`);
  return { ...result, run_id: data.id, changes, elapsed_ms: Date.now() - start };
}

const visibleKeys = ["id", "project_id", "vendor_name", "invoice_number", "invoice_date", "description", "amount", "paid_amount", "estimate_line_item_id", "quote_request_id", "split_group_id", "duplicate_of_id", "review_status", "review_reason", "notes", "started_at", "ended_at", "schedule_phase_id", "line_item_note", "status", "name", "title", "total_cost", "total_price", "trade", "due_date", "sent_to_client_at", "subject", "snippet", "received_at", "bucket", "path", "version", "etag", "available", "created_at", "updated_at"];
export async function inspectFinding(actor: string, project: string, run: string, finding: string) {
  // Role/project existence validated again through the same database guard.
  const check = await db().rpc("job_review_require_actor", { p_actor_id: actor });
  if (check.error) throw new Error(check.error.message);
  const { data, error } = await db().from("job_review_runs").select("snapshot,result,source_register,checked_at").eq("id", run).eq("project_id", project).single();
  if (error || !data) throw new Error("Saved review not found for this job.");
  const match = (data.result as JobReview).findings.find(f => f.id === finding);
  if (!match) throw new Error("Finding not found in this review.");
  const snapshot = data.snapshot as Snapshot;
  const sources = await Promise.all(match.refs.map(async ref => {
    const colon = ref.indexOf(":"), source = ref.slice(0, colon), id = ref.slice(colon + 1);
    const row = snapshot.records[source]?.find(r => String(r.id) === id);
    if (!row) return { ref, missing: true };
    const fields = Object.fromEntries(visibleKeys.filter(k => k in row).map(k => [k, row[k]]));
    const paths = [row.attachment_storage_path, row.storage_path, ...(Array.isArray(row.photo_storage_paths) ? row.photo_storage_paths : [])].filter((p): p is string => typeof p === "string");
    const objects = snapshot.records.storage_objects?.filter(o => paths.includes(String(o.path))) ?? [];
    const documents = await Promise.all(objects.map(async o => {
      const signed = await db().storage.from(String(o.bucket)).createSignedUrl(String(o.path), 600);
      return { ref: `storage_objects:${o.id}`, version: o.version, etag: o.etag, url: signed.data?.signedUrl ?? null, unavailable: !!signed.error };
    }));
    return { ref, fingerprint: data.source_register[ref], fields, documents };
  }));
  return { as_of: data.checked_at, finding: match, sources, note: "Saved evidence. Fetch a fresh review before changing a record. Open originals before confirming a discrepancy." };
}

export type CorrectionInput = { kind: "invoice_allocation" | "labor_allocation"; record_id: string; target_line_id: string; reason: string; evidence_refs: string[] };
export async function previewCorrection(actor: string, project: string, input: CorrectionInput) {
  const snapshot = await loadSnapshot(actor, project);
  const register = sourceRegister(snapshot);
  if (input.evidence_refs.some(k => !(k in register))) throw new Error("An evidence reference is missing. Refresh and inspect the finding first.");
  const source = input.kind === "invoice_allocation" ? "invoices" : "all_day_shifts";
  if (!input.evidence_refs.includes(`${source}:${input.record_id}`)) throw new Error("Include the affected record in the evidence references.");
  const evidence = await loadEvidence(project);
  const before = calculateReview(snapshot, evidence);
  const changed = structuredClone(snapshot);
  const row = changed.records[source].find(r => r.id === input.record_id);
  if (!row) throw new Error("Record not on this job.");
  row.estimate_line_item_id = input.target_line_id;
  const after = calculateReview(changed, evidence);
  if (before.money.recorded_cost !== after.money.recorded_cost || before.money.net_minutes !== after.money.net_minutes) throw new Error("An allocation correction must preserve total costs and hours.");
  const effects = before.scopes.flatMap(s => {
    const a = after.scopes.find(x => x.id === s.id)!;
    return a.cost !== s.cost || a.minutes !== s.minutes ? [{ line_id: s.id, name: s.name, budget: s.budget, before_cost: s.cost, after_cost: a.cost, before_minutes: s.minutes, after_minutes: a.minutes }] : [];
  });
  const { data, error } = await db().rpc("job_review_preview", { p_actor_id: actor, p_project_id: project, p_kind: input.kind, p_record_id: input.record_id, p_target_line_id: input.target_line_id, p_reason: input.reason, p_evidence_refs: input.evidence_refs });
  if (error || !data) throw new Error(error?.message ?? "Could not create correction preview.");
  // The preview's expected record must be the exact version just calculated.
  const original = snapshot.records[source].find(r => r.id === input.record_id)!;
  // all_day_shifts resolves a null project via the phase; compare original daily log.
  const expected = source === "invoices" ? original : snapshot.records.daily_logs.find(r => r.id === input.record_id)!;
  if (fingerprint(expected) !== fingerprint(data.record)) throw new Error("Record changed while calculating. Preview again.");
  const recheck = await loadSnapshot(actor, project);
  if (fingerprint(snapshot.records) !== fingerprint(recheck.records)) throw new Error("Job or evidence changed while calculating the preview. Preview again.");
  const preview = { id: data.id as string, kind: input.kind, record_id: input.record_id, target_line_id: input.target_line_id, reason: input.reason, effects, total_cost_before: before.money.recorded_cost, total_cost_after: after.money.recorded_cost, net_minutes_before: before.money.net_minutes, net_minutes_after: after.money.net_minutes, evidence_refs: input.evidence_refs, expires_in_minutes: 15 };
  const saved = await db().from("job_review_corrections").update({ preview }).eq("id", data.id).eq("actor_id", actor).is("applied_at", null);
  if (saved.error) throw new Error(saved.error.message);
  return preview;
}
export async function applyCorrection(actor: string, project: string, preview: string) {
  const { data, error } = await db().rpc("job_review_apply", { p_actor_id: actor, p_project_id: project, p_preview_id: preview });
  if (error) throw new Error(error.message);
  // A transport failure after commit is recoverable: retry the same preview ID.
  // Never report rollback when the financial write has actually committed.
  try {
    const review = await reviewJob(actor, project);
    return { ...data, verification: "Current totals recalculated and saved", review };
  } catch {
    return { ...data, verification: "Correction applied; refreshing the review failed. Fetch get_job_review to verify current totals." };
  }
}
export async function saveEvidence(actor: string, project: string, run: string, input: { title: string; action: string; classification: Evidence["classification"]; line_id: string | null; refs: string[]; resolved: boolean; priority: number; supersedes_id?: string }) {
  const snapshot = await loadSnapshot(actor, project);
  const { data, error } = await db().from("job_review_runs").select("source_register").eq("id", run).eq("project_id", project).single();
  if (error || !data) throw new Error("Review not found.");
  const current = sourceRegister(snapshot);
  if (input.refs.some(k => !current[k] || current[k] !== data.source_register[k])) throw new Error("Evidence changed since this review. Inspect it again before saving.");
  if (input.line_id && !snapshot.records.lines.some(l => l.id === input.line_id)) throw new Error("Line is not on this project.");
  if (input.classification === "verified_cost") {
    const scope = calculateReview(snapshot).scopes.find(s => s.id === input.line_id);
    if (!scope) throw new Error("Verified cost needs a line on the current estimate.");
    const required = costEvidenceDependencies(snapshot, scope);
    if (required.some(k => !input.refs.includes(k))) throw new Error("Include the cost line, project, every contributing bill/shift, versioned originals and wage/break dependencies before marking cost verified.");
  }
  if (input.supersedes_id) {
    const prior = await db().from("job_review_evidence").select("id").eq("id", input.supersedes_id).eq("project_id", project).single();
    if (prior.error || !prior.data) throw new Error("Prior finding is not on this job.");
  }
  const refs = Object.fromEntries(input.refs.map(k => [k, current[k]]));
  const { data: saved, error: saveError } = await db().from("job_review_evidence").insert({ ...input, refs, project_id: project, actor_id: actor }).select("id,reviewed_at").single();
  if (saveError) throw new Error(saveError.message);
  return saved;
}
