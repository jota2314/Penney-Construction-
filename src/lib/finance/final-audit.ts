import {
  calculateReview,
  costEvidenceDependencies,
  sourceRegister,
  type Snapshot,
  type Evidence,
} from "@/lib/job-review/engine";

// These are presence warnings, not calculated errors. A reviewer can establish
// that the separate records are already included in the final cost model. Never
// use resolved notes to dismiss missing amounts/rates, open shifts, mismatched
// client payments or outstanding commitments.
const coverageChecks = [
  {
    title:
      "Material orders need a remaining-cost check; order status alone does not establish unbilled dollars.",
    source: "material_orders",
    active: (r: Snapshot["records"][string][number]) =>
      !["cancelled", "rejected"].includes(String(r.status)),
    sources: ["material_orders", "material_order_items", "quotes"],
  },
  {
    title:
      "Verify return credits against booked bills; a return request is not a received credit.",
    source: "material_returns",
    active: (r: Snapshot["records"][string][number]) =>
      r.status !== "cancelled",
    sources: ["material_returns", "material_orders"],
  },
  {
    title:
      "Additional time entries exist; reconcile them with clocked/ledger labor before final profit.",
    source: "time_entries",
    active: () => true,
    sources: ["time_entries", "job_ledger_entries"],
  },
  {
    title:
      "Separate ledger entries exist; reconcile their overlap with bills before final profit.",
    source: "job_ledger_entries",
    active: () => true,
    sources: [
      "job_ledger_entries",
      "time_entries",
      "payments_received",
      "client_invoices",
    ],
  },
] as const;

const reconciliationSources = [
  "projects",
  "estimates",
  "lines",
  "change_orders",
  "invoices",
  "all_day_shifts",
  "employees",
  "rates",
  "breaks",
  "schedule_phases",
  "storage_objects",
] as const;

/**
 * Exact titles and current source hashes required to resolve presence warnings.
 * A resolved question must also reference its supporting project report and
 * that report's available, versioned storage object. Missing inventories remain
 * blocked; in particular order headers cannot stand in for their line items.
 */
export function finalAuditCoverageRequirements(
  snapshot: Snapshot,
): { title: string; refs: Record<string, string> }[] {
  const register = sourceRegister(snapshot);
  return coverageChecks.flatMap((check) => {
    const sources = [...reconciliationSources, ...check.sources];
    if (
      !snapshot.records[check.source]?.some(check.active) ||
      sources.some((source) => !Array.isArray(snapshot.records[source]))
    )
      return [];
    // Require the complete relevant inventories, not just an existing subset:
    // adding a row must invalidate the earlier reconciliation as well as edits.
    const refs = Object.fromEntries(
      [...new Set(sources)].flatMap((source) =>
        snapshot.records[source].map((row) => {
          const key = `${source}:${row.id}`;
          return [key, register[key]];
        }),
      ),
    );
    return [{ title: check.title, refs }];
  });
}

function referencesVersionedReport(snapshot: Snapshot, note: Evidence) {
  return (snapshot.records.project_files ?? []).some(
    (file) =>
      `project_files:${file.id}` in note.refs &&
      typeof file.storage_path === "string" &&
      (snapshot.records.storage_objects ?? []).some(
        (object) =>
          object.path === file.storage_path &&
          object.bucket === (file.storage_bucket || "project-files") &&
          object.available === true &&
          [object.version, object.etag].some(
            (value) => typeof value === "string" && value.trim().length > 0,
          ) &&
          `storage_objects:${object.id}` in note.refs,
      ),
  );
}

/** Finality requires current evidence, not just a successful automatic review. */
export function finalAuditReadiness(snapshot: Snapshot, evidence: Evidence[]) {
  const review = calculateReview(snapshot, evidence);
  const register = sourceRegister(snapshot);
  const superseded = new Set(
    evidence.map((e) => e.supersedes_id).filter(Boolean),
  );
  const current = evidence.filter((e) => !superseded.has(e.id));
  const matches = (e: Evidence) =>
    Object.keys(e.refs).length > 0 &&
    Object.entries(e.refs).every(([k, v]) => register[k] === v);
  const requirements = finalAuditCoverageRequirements(snapshot);
  const blockers = review.coverage.gaps.filter((gap) => {
    const requirement = requirements.find((r) => r.title === gap);
    return (
      !requirement ||
      !current.some(
        (note) =>
          note.classification === "question" &&
          note.resolved &&
          note.title === requirement.title &&
          note.action.trim().length >= 20 &&
          matches(note) &&
          Object.keys(requirement.refs).every((key) => key in note.refs) &&
          referencesVersionedReport(snapshot, note),
      )
    );
  }).map((gap) =>
    gap === coverageChecks[0].title &&
    !Array.isArray(snapshot.records.material_order_items)
      ? "Material order items are missing from the review inventory; load item-level quantities and fulfillment before finalizing."
      : gap,
  );
  if (review.money.contract === null)
    blockers.push("Verify the signed contract and approved changes.");
  if (review.money.known_unbilled_commitments > 0)
    blockers.push("Reconcile remaining vendor commitments before finalizing.");
  if (
    snapshot.records.change_orders.some(
      (c) =>
        !["approved", "rejected", "cancelled", "void", "voided"].includes(
          String(c.status),
        ),
    )
  )
    blockers.push("Resolve draft or pending change orders.");
  for (const note of current) {
    if (!matches(note))
      blockers.push(`Recheck changed evidence: ${note.title}`);
    else if (!note.resolved && note.classification !== "verified_cost")
      blockers.push(`Resolve finding: ${note.title}`);
  }
  if (review.findings.some((f) => f.kind === "allocation_question"))
    blockers.push("Resolve bill and crew allocation questions.");
  for (const scope of review.scopes) {
    if (!scope.bill_ids.length && !scope.shift_ids.length) continue;
    if (scope.id === "unallocated") {
      blockers.push("Allocate all recorded costs to the current scope.");
      continue;
    }
    try {
      const refs = costEvidenceDependencies(snapshot, scope);
      if (
        !current.some(
          (e) =>
            e.classification === "verified_cost" &&
            e.line_id === scope.id &&
            matches(e) &&
            refs.every((k) => k in e.refs),
        )
      )
        blockers.push(`Verify source costs for ${scope.name}.`);
    } catch {
      blockers.push(
        `Attach and verify the original cost documents for ${scope.name}.`,
      );
    }
  }
  return { review, blockers: [...new Set(blockers)] };
}
