"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { JobReviewPanel } from "./job-review-panel";
import type { JobReview } from "@/lib/job-review/engine";
import type { ProjectHealth } from "@/lib/finance/workspace-model";

type Preview = {
  review: JobReview;
  blockers: string[];
  files: { id: string; filename: string }[];
  head: { id: string; kind: string } | null;
};
const money = (n: number | null) =>
  n === null
    ? "Not verified"
    : (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const field = "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";
export function AuditWorkspace({
  job,
  onClose,
  canFinalize,
  today,
}: {
  job: ProjectHealth;
  onClose: () => void;
  canFinalize: boolean;
  today: string;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [note, setNote] = useState(""),
    [remaining, setRemaining] = useState(""),
    [closedOn, setClosedOn] = useState(job.closedOn || today),
    [report, setReport] = useState("");
  const [burden, setBurden] = useState("0"),
    [overhead, setOverhead] = useState("0"),
    [attested, setAttested] = useState(false),
    [done, setDone] = useState("");
  const final = job.audit?.kind === "final";
  const value = (s: string) =>
    s.trim() !== "" && Number.isFinite(Number(s)) && Number(s) >= 0
      ? Math.round(Number(s) * 100)
      : null;
  async function request(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/finance-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, project_id: job.id, ...extra }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to save audit.");
      if (action === "prepare") {
        setPreview(result);
        setAttested(false);
      } else {
        setDone(
          action === "finalize"
            ? "Final audit saved. This P&L is frozen in closing-period history."
            : action === "reopen"
              ? "Audit reopened. The earlier final P&L remains in its revision history."
              : "Remaining-cost forecast saved.",
        );
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  const finalCost =
    preview && value(burden) !== null && value(overhead) !== null
      ? preview.review.money.recorded_cost + value(burden)! + value(overhead)!
      : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{job.name} · Audit &amp; forecast</DialogTitle>
          <DialogDescription>
            Review current evidence, save remaining costs, or finalize the
            project’s P&amp;L.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 overflow-y-auto pr-1 text-sm">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-500/30 p-3 text-red-600"
            >
              {error}
            </p>
          )}
          {done ? (
            <>
              <p role="status" className="rounded-lg bg-emerald-500/10 p-4">
                {done}
              </p>
              <Button onClick={onClose}>Done</Button>
            </>
          ) : (
            <>
              {final ? (
                <>
                  <p>
                    Final audit dated {job.audit!.closed_on}, approved by{" "}
                    {job.audit!.actor_name}. Reopening preserves that report and
                    removes it from the current finalized totals until a new
                    final audit is approved.
                  </p>
                  {canFinalize && (
                    <>
                      <label className="block">
                        Reason for reopening
                        <textarea
                          className={field}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Describe the new bill, correction or unresolved issue (at least 20 characters)."
                        />
                      </label>
                      <Button
                        variant="outline"
                        disabled={busy || note.trim().length < 20}
                        onClick={() =>
                          request("reopen", { record_id: job.audit!.id, note })
                        }
                      >
                        Reopen this final audit
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Button onClick={() => request("prepare")} disabled={busy}>
                    {busy
                      ? "Checking current records…"
                      : preview
                        ? "Refresh audit checks"
                        : "Check audit readiness"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    This saves a current review. It does not mark the project
                    complete or change invoices, costs or payments.
                  </p>
                  {preview && (
                    <>
                      <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4">
                        <div>
                          Contract + approved changes
                          <strong className="block text-lg">
                            {money(preview.review.money.contract)}
                          </strong>
                        </div>
                        <div>
                          Recorded job cost
                          <strong className="block text-lg">
                            {money(preview.review.money.recorded_cost)}
                          </strong>
                        </div>
                      </div>
                      <JobReviewPanel projectId={job.id} />
                      {canFinalize && (
                        <section className="space-y-3 rounded-xl border p-4">
                          <h3 className="font-semibold">Cost to finish</h3>
                          <p className="text-xs text-muted-foreground">
                            Enter all remaining costs, including unbilled
                            commitments of{" "}
                            {money(
                              preview.review.money.known_unbilled_commitments,
                            )}
                            . This is an estimate in addition to recorded costs.
                          </p>
                          <label className="block">
                            Estimated remaining cost ($)
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className={field}
                              value={remaining}
                              onChange={(e) => setRemaining(e.target.value)}
                            />
                          </label>
                          <label className="block">
                            Basis and evidence
                            <textarea
                              className={field}
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              placeholder="Explain remaining trades, quantities, quotes and assumptions."
                            />
                          </label>
                          <Button
                            variant="outline"
                            disabled={
                              busy ||
                              value(remaining) === null ||
                              note.trim().length < 20
                            }
                            onClick={() =>
                              request("forecast", {
                                run_id: preview.review.run_id,
                                remaining: value(remaining),
                                note,
                              })
                            }
                          >
                            Save remaining-cost forecast
                          </Button>
                        </section>
                      )}
                      <section className="space-y-3 rounded-xl border p-4">
                        <h3 className="font-semibold">Final audit done</h3>
                        {preview.blockers.length > 0 ? (
                          <>
                            <p className="text-amber-700 dark:text-amber-400">
                              Resolve these checks before finalizing:
                            </p>
                            <ul className="list-disc space-y-1 pl-5">
                              {preview.blockers.map((b) => (
                                <li key={b}>{b}</li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p>
                            Recorded cost checks passed. Confirm completion and
                            the final report below.
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          The report must reconcile signed revenue, all costs,
                          payroll, allowances, commitments, permits/inspections
                          and client acceptance. Uncollected revenue and unpaid
                          bills remain separate from profit.
                        </p>
                        {canFinalize && (
                          <>
                            <label className="block">
                              Project closing date
                              <input
                                className={field}
                                type="date"
                                max={today}
                                value={closedOn}
                                onChange={(e) => setClosedOn(e.target.value)}
                              />
                            </label>
                            <label className="block">
                              Final audit report from project Files
                              <select
                                className={field}
                                value={report}
                                onChange={(e) => setReport(e.target.value)}
                              >
                                <option value="">
                                  Choose the reviewed final report
                                </option>
                                {preview.files.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.filename}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <a
                              className="underline"
                              href={`/projects/${job.id}?tab=files`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open project Files to inspect or upload the audit
                              report
                            </a>
                            <div className="grid grid-cols-2 gap-3">
                              <label>
                                Additional payroll burden ($)
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className={field}
                                  value={burden}
                                  onChange={(e) => setBurden(e.target.value)}
                                />
                              </label>
                              <label>
                                Allocated company overhead ($)
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className={field}
                                  value={overhead}
                                  onChange={(e) => setOverhead(e.target.value)}
                                />
                              </label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Only amounts not already in recorded job costs.
                              Explain both figures, including any zero amount,
                              in the final report and approval note.
                            </p>
                            <label className="block">
                              Final approval note
                              <textarea
                                className={field}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="State the evidence and payroll/overhead basis for this final P&L."
                              />
                            </label>
                            <div className="rounded-lg bg-muted/40 p-3">
                              Final total cost:{" "}
                              <strong>{money(finalCost)}</strong>
                              <br />
                              Final profit after stated allocations:{" "}
                              <strong>
                                {money(
                                  finalCost !== null &&
                                    preview.review.money.contract !== null
                                    ? preview.review.money.contract - finalCost
                                    : null,
                                )}
                              </strong>
                            </div>
                            <label className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={attested}
                                onChange={(e) => setAttested(e.target.checked)}
                              />
                              <span>
                                I reviewed the source evidence and final report,
                                confirmed completion and all remaining
                                obligations, reconciled payroll and allowances,
                                and approve these final P&amp;L figures.
                              </span>
                            </label>
                            <Button
                              disabled={
                                busy ||
                                !!preview.blockers.length ||
                                !report ||
                                !attested ||
                                note.trim().length < 20 ||
                                !closedOn ||
                                finalCost === null
                              }
                              onClick={() =>
                                request("finalize", {
                                  run_id: preview.review.run_id,
                                  closed_on: closedOn,
                                  report_file_id: report,
                                  note,
                                  payroll_burden: value(burden),
                                  allocated_overhead: value(overhead),
                                  attested: true,
                                })
                              }
                            >
                              Approve final audit &amp; freeze P&amp;L
                            </Button>
                          </>
                        )}
                      </section>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
