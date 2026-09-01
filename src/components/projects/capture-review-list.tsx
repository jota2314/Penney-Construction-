"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  resolveCapture,
  discardCapture,
  listBudgetLinesForJob,
  type CaptureBudgetLine,
  type CaptureForReview,
  type CaptureJobOption,
} from "@/lib/actions/field-capture";

/**
 * The office review queue for receipts the crew photographed. One card per
 * flagged capture: the photo next to the numbers the AI read, so a wrong total
 * is caught by looking, not by opening a second tab.
 */

const money = (n: number | null): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

function CaptureCard({
  capture,
  jobs,
}: {
  capture: CaptureForReview;
  jobs: CaptureJobOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [vendor, setVendor] = useState(capture.vendor_name);
  const [amount, setAmount] = useState(
    capture.amount === null ? "" : String(capture.amount),
  );
  const [projectId, setProjectId] = useState(capture.project_id ?? "");
  const [lineItemId, setLineItemId] = useState(capture.line_item_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);

  const movedJob = projectId !== (capture.project_id ?? "");

  // Budget lines belong to whichever job is currently selected. Moving a
  // capture used to kill the picker until you saved and re-opened the queue;
  // now the new job's lines load in place so one correction is one pass.
  const [lines, setLines] = useState<CaptureBudgetLine[]>(capture.budget_lines);
  const [loadingLines, setLoadingLines] = useState(false);

  useEffect(() => {
    if (!movedJob) {
      setLines(capture.budget_lines);
      return;
    }
    let cancelled = false;
    setLoadingLines(true);
    listBudgetLinesForJob(projectId)
      .then((rows) => {
        if (!cancelled) setLines(rows);
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLines(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, movedJob, capture.budget_lines]);

  function confirm() {
    setError(null);
    const parsed = amount.trim() === "" ? undefined : Number(amount);
    // Negative is a credit (a return, a billing correction) — only zero is
    // never a document.
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed === 0)) {
      setError("Enter a real dollar amount");
      return;
    }
    startTransition(async () => {
      const result = await resolveCapture({
        invoiceId: capture.id,
        vendorName: vendor,
        amount: parsed,
        projectId: movedJob ? projectId : undefined,
        lineItemId: lineItemId || null,
      });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function discard() {
    setError(null);
    startTransition(async () => {
      const result = await discardCapture(capture.id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        {/* Photo */}
        <div className="sm:w-48 shrink-0 bg-muted">
          {capture.photo_url ? (
            <button
              type="button"
              onClick={() => setZoom(true)}
              className="block w-full h-48 sm:h-full"
              aria-label="View the receipt photo full size"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={capture.photo_url}
                alt={`${capture.vendor_name} receipt`}
                className="w-full h-48 sm:h-full object-cover"
              />
            </button>
          ) : (
            <div className="w-full h-48 sm:h-full flex items-center justify-center text-xs text-muted-foreground">
              No photo
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 p-4 flex flex-col gap-3 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-amber-600 font-semibold">
                Needs a look
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {capture.review_reason}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-semibold">{money(capture.amount)}</div>
              <div className="text-[11px] text-muted-foreground">
                {capture.invoice_date ?? "no date"}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Vendor
              </span>
              <input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="rounded-lg border bg-background px-2.5 py-1.5 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Amount
              </span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="rounded-lg border bg-background px-2.5 py-1.5 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Job
              </span>
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setLineItemId("");
                }}
                className="rounded-lg border bg-background px-2.5 py-1.5 text-sm"
              >
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Budget line
              </span>
              <select
                value={lineItemId}
                onChange={(e) => setLineItemId(e.target.value)}
                disabled={loadingLines}
                className="rounded-lg border bg-background px-2.5 py-1.5 text-sm disabled:opacity-50"
              >
                <option value="">
                  {loadingLines
                    ? "Loading lines…"
                    : lines.length === 0
                      ? "This job has no estimate lines yet"
                      : "Unassigned"}
                </option>
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.description}
                    {line.trade ? ` · ${line.trade}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {capture.description && (
            <div className="text-xs text-muted-foreground">{capture.description}</div>
          )}

          {error && <div className="text-xs text-red-500">{error}</div>}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={confirm}
              disabled={pending}
              className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Saving…" : "Confirm"}
            </button>
            <button
              onClick={discard}
              disabled={pending}
              className="rounded-lg border px-3.5 py-1.5 text-sm text-muted-foreground disabled:opacity-50"
            >
              Discard
            </button>
            {capture.project_id && (
              <Link
                href={`/projects/${capture.project_id}?tab=finances`}
                className="text-sm text-muted-foreground underline underline-offset-2"
              >
                Open job
              </Link>
            )}
          </div>
        </div>
      </div>

      {zoom && capture.photo_url && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoom(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={capture.photo_url}
            alt={`${capture.vendor_name} receipt`}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </div>
  );
}

export function CaptureReviewList({
  captures,
  jobs,
}: {
  captures: CaptureForReview[];
  jobs: CaptureJobOption[];
}) {
  if (captures.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <div className="text-sm font-medium">Nothing to check</div>
        <div className="text-xs text-muted-foreground mt-1">
          Every receipt the crew captured filed itself cleanly.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {captures.map((capture) => (
        <CaptureCard key={capture.id} capture={capture} jobs={jobs} />
      ))}
    </div>
  );
}
