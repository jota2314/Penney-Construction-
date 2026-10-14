"use client";
import { useRef, useState } from "react";
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
import type { OverheadAllocation } from "@/lib/finance/overhead-allocation";

type Preview = {
  review: JobReview;
  blockers: string[];
  files: { id: string; filename: string }[];
  head: { id: string; kind: string } | null;
  overhead: OverheadAllocation;
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
  const closeoutSection = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [note, setNote] = useState(""),
    [remaining, setRemaining] = useState(""),
    [closedOn, setClosedOn] = useState(job.closedOn || today),
    [report, setReport] = useState("");
  const [burden, setBurden] = useState(""),
    [overheadAccepted, setOverheadAccepted] = useState(false),
    [attested, setAttested] = useState(false),
    [done, setDone] = useState(""),
    [savedId, setSavedId] = useState("");
  const final = job.audit?.kind === "final";
  const value = (s: string) =>
    s.trim() !== "" && Number.isFinite(Number(s)) && Number(s) >= 0
      ? Math.round(Number(s) * 100)
      : null;
  async function request(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    if (action === "prepare") {
      setPreview(null);
      setOverheadAccepted(false);
      setAttested(false);
    }
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
            ? "Job financially closed. Its final costs, overhead and net profit are saved in closing-period history."
            : action === "reopen"
              ? "Audit reopened. The earlier final P&L remains in its revision history."
              : "Remaining-cost forecast saved.",
        );
        if (action === "finalize") setSavedId(result.id);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  const costChecksPassed = preview !== null && preview.blockers.length === 0;
  const finalCost =
    preview && costChecksPassed && value(burden) !== null && preview.overhead.allocated !== null
      ? preview.review.money.recorded_cost + value(burden)! + preview.overhead.allocated
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
              {savedId && <a className="block underline" target="_blank" rel="noreferrer" href={`/api/finance-audit/${savedId}/report`}>Open final job P&amp;L</a>}
              <Button onClick={onClose}>Done</Button>
            </>
          ) : (
            <>
              {final ? (
                <>
                  {job.finalNeedsReview && <p role="alert" className="rounded-lg bg-amber-500/10 p-3">Sources changed or could not be verified since closure. The saved figures below are historical; reopen and audit the changes before accepting a new final result.</p>}
                  <p>
                    Final audit dated {job.audit!.closed_on}, approved by{" "}
                    {job.audit!.actor_name}. Reopening preserves that report and
                    removes it from the current finalized totals until a new
                    final audit is approved.
                  </p>
                  <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4">
                    {[
                      ["Final revenue", job.audit!.payload.contract],
                      ["Net receipts", job.audit!.payload.received],
                      ["Recorded job costs", job.audit!.payload.cost],
                      ["Additional payroll burden", job.audit!.payload.payroll_burden],
                      ["Gross profit before overhead", job.audit!.payload.gross_profit],
                      ["Allocated actual overhead", job.audit!.payload.allocated_overhead],
                      ["Total final cost", job.audit!.payload.final_cost],
                      ["Final net profit", job.audit!.payload.profit],
                    ].map(([label, amount]) => <div key={String(label)}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{money(typeof amount === "number" ? amount : null)}</dd></div>)}
                  </dl>
                  <a className="block underline" target="_blank" rel="noreferrer" href={`/api/finance-audit/${job.audit!.id}/report`}>Open saved P&amp;L and audit evidence</a>
                  {canFinalize && (
                    <>
                      <label className="block">
                        Reason for reopening
                        <textarea
                          className={field}
                          value={note}
                          onChange={(e) => { setNote(e.target.value); setAttested(false); }}
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
                      <JobReviewPanel projectId={job.id} onOpenAudit={() => closeoutSection.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />
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
                              onChange={(e) => { setNote(e.target.value); setAttested(false); }}
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
                      <section ref={closeoutSection} className="space-y-3 rounded-xl border p-4">
                        <h3 className="font-semibold">Close this job</h3>
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
                                onChange={(e) => { setClosedOn(e.target.value); setAttested(false); }}
                              />
                            </label>
                            <label className="block">
                              Final audit report from project Files
                              <select
                                className={field}
                                value={report}
                                onChange={(e) => { setReport(e.target.value); setAttested(false); }}
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
                            <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                              <p className="font-medium">Allocated actual company overhead: {money(preview.overhead.allocated)}</p>
                              <p className="text-xs text-muted-foreground">Calculated from the overhead already recorded in Finances. For each month: actual company overhead × this job’s net receipts ÷ company net receipts. Review and accept this allocation basis before closing.</p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-right text-xs">
                                  <thead><tr><th className="p-2 text-left">Month</th><th className="p-2">Overhead pool</th><th className="p-2">Company receipts</th><th className="p-2">Job receipts</th><th className="p-2">Job overhead</th></tr></thead>
                                  <tbody>{preview.overhead.months.map((m) => <tr key={m.month} className="border-t"><td className="p-2 text-left">{m.month}</td><td className="p-2">{money(m.overhead)}</td><td className="p-2">{money(m.companyReceipts)}</td><td className="p-2">{money(m.jobReceipts)}</td><td className="p-2">{money(m.allocated)}</td></tr>)}</tbody>
                                </table>
                              </div>
                              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={overheadAccepted} onChange={(e) => setOverheadAccepted(e.target.checked)} disabled={preview.overhead.allocated === null} /><span>I reviewed the recorded overhead sources and accept this monthly allocation for the job.</span></label>
                            </div>
                            <div>
                              <label>
                                Additional payroll burden ($)
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className={field}
                                  value={burden}
                                  onChange={(e) => { setBurden(e.target.value); setAttested(false); }}
                                />
                              </label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Enter only payroll burden not already in job costs or company overhead. Reconcile wages, taxes and benefits in the report; enter zero only when verified.
                            </p>
                            <label className="block">
                              Final approval note
                              <textarea
                                className={field}
                                value={note}
                                onChange={(e) => { setNote(e.target.value); setAttested(false); }}
                                placeholder="State the evidence and payroll/overhead basis for this final P&L."
                              />
                            </label>
                            <div className="rounded-lg bg-muted/40 p-3">
                              Net recorded receipts: <strong>{money(preview.review.money.received)}</strong><br />
                              Contract + approved changes: <strong>{money(preview.review.money.contract)}</strong><br />
                              Gross profit preview before overhead: <strong>{money(costChecksPassed && preview.review.money.contract !== null && value(burden) !== null ? preview.review.money.contract - preview.review.money.recorded_cost - value(burden)! : null)}</strong><br />
                              Proposed total cost:{" "}
                              <strong>{money(finalCost)}</strong>
                              <br />
                              Net profit preview after overhead:{" "}
                              <strong>
                                {money(
                                  finalCost !== null &&
                                    preview.review.money.contract !== null
                                    ? preview.review.money.contract - finalCost
                                    : null,
                                )}
                              </strong>
                              <br />Net margin preview: <strong>{finalCost !== null && preview.review.money.contract ? `${((preview.review.money.contract - finalCost) / preview.review.money.contract * 100).toFixed(2)}%` : "Not verified"}</strong>
                              <p className="mt-2 text-xs text-muted-foreground">Net receipts include recorded returns and bounced-check reversals. Profit is based on contract revenue, separate from cash collected. These figures remain provisional until the final audit is approved; unresolved cost checks keep profit unverified.</p>
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
                                documented any remaining receivables/payables, and approve closing the job with these final P&amp;L figures.
                              </span>
                            </label>
                            <Button
                              disabled={
                                busy ||
                                !!preview.blockers.length ||
                                !report ||
                                !attested ||
                                !overheadAccepted ||
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
                                  overhead_fingerprint: preview.overhead.fingerprint,
                                  overhead_accepted: true,
                                  attested: true,
                                })
                              }
                            >
                              Approve final audit &amp; close job
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
