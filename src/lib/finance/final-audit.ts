import {
  calculateReview,
  costEvidenceDependencies,
  sourceRegister,
  type Snapshot,
  type Evidence,
} from "@/lib/job-review/engine";

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
  const blockers = [...review.coverage.gaps];
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
