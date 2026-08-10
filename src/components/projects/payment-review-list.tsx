"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  resolvePayment,
  discardPayment,
  type PaymentForReview,
  type PaymentJobOption,
} from "@/lib/actions/deposit-capture";

/**
 * The office review queue for client payments captured off a check photo — the
 * money-IN mirror of CaptureReviewList. One card per flagged payment: the check
 * next to the numbers the AI read, so a wrong amount is caught by looking.
 *
 * Simpler than the receipt card on purpose: a payment has no budget lines to
 * allocate across, so the only things that can be wrong are the payer, the
 * amount, the job, and what kind of payment it was.
 */

const PAYMENT_TYPES = [
  "deposit",
  "progress",
  "draw",
  "change_order",
  "retainage",
  "final",
  "other",
] as const;

const money = (n: number | null): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

function PaymentCard({
  payment,
  jobs,
}: {
  payment: PaymentForReview;
  jobs: PaymentJobOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [payer, setPayer] = useState(payment.payer_name ?? "");
  const [amount, setAmount] = useState(
    payment.amount === null ? "" : String(payment.amount),
  );
  const [projectId, setProjectId] = useState(payment.project_id ?? "");
  const [paymentType, setPaymentType] = useState(payment.payment_type);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);

  const movedJob = projectId !== (payment.project_id ?? "");

  function confirm() {
    setError(null);
    const parsed = amount.trim() === "" ? undefined : Number(amount);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed <= 0)) {
      setError("Enter a real dollar amount");
      return;
    }
    startTransition(async () => {
      const result = await resolvePayment({
        paymentId: payment.id,
        payerName: payer,
        amount: parsed,
        paymentType,
        projectId: movedJob ? projectId : undefined,
      });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function discard() {
    setError(null);
    startTransition(async () => {
      const result = await discardPayment(payment.id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  const photoAlt = `Payment from ${payment.payer_name ?? "a client"}`;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        {/* Photo */}
        <div className="sm:w-48 shrink-0 bg-muted">
          {payment.photo_url ? (
            <button
              type="button"
              onClick={() => setZoom(true)}
              className="block w-full h-48 sm:h-full"
              aria-label="View the check photo full size"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={payment.photo_url}
                alt={photoAlt}
                className="w-full h-48 sm:h-full object-cover"
              />
            </button>
          ) : (
            <div className="w-full h-48 sm:h-full flex items-center justify-center text-xs text-muted-foreground">
              Entered by hand
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
                {payment.review_reason}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-semibold text-emerald-600">
                {money(payment.amount)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {[payment.received_date ?? "no date", payment.method].filter(Boolean).join(" · ")}
                {payment.reference_number ? ` · #${payment.reference_number}` : ""}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                From
              </span>
              <input
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
                placeholder="Client name"
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
                onChange={(e) => setProjectId(e.target.value)}
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
                Kind
              </span>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value)}
                className="rounded-lg border bg-background px-2.5 py-1.5 text-sm"
              >
                {PAYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {payment.description && (
            <div className="text-xs text-muted-foreground">{payment.description}</div>
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
            {payment.project_id && (
              <Link
                href={`/projects/${payment.project_id}?tab=finances`}
                className="text-sm text-muted-foreground underline underline-offset-2"
              >
                Open job
              </Link>
            )}
          </div>
        </div>
      </div>

      {zoom && payment.photo_url && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoom(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={payment.photo_url}
            alt={photoAlt}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </div>
  );
}

export function PaymentReviewList({
  payments,
  jobs,
}: {
  payments: PaymentForReview[];
  jobs: PaymentJobOption[];
}) {
  if (payments.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <div className="text-sm font-medium">Nothing to check</div>
        <div className="text-xs text-muted-foreground mt-1">
          Every payment logged so far filed itself cleanly.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {payments.map((payment) => (
        <PaymentCard key={payment.id} payment={payment} jobs={jobs} />
      ))}
    </div>
  );
}
