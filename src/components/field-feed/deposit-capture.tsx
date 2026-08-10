"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v } from "@/components/field-feed/tokens";
import { compressImage } from "@/lib/image/compress";
import { searchActiveJobs, type ClockInJob } from "@/lib/actions/daily-logs";

/**
 * "Log a deposit" — the money-IN twin of ReceiptCapture.
 *
 * A client hands over a check on the jobsite. Photograph it, Claude reads the
 * payer, amount, check number and memo, matches it to a job, and only Confirm
 * files it into payments_received. Wires and Zelle have no paper to shoot, so
 * there is a manual path to the same confirm screen.
 *
 * Before this, nothing in the app UI could record a client payment at all —
 * payments_received only got rows from the email engine, the chat tool and the
 * QuickBooks sync.
 */

type Scan = {
  storagePath: string;
  documentType: string;
  payer: string | null;
  amount: number | null;
  checkNumber: string | null;
  date: string | null;
  method: string | null;
  memo: string | null;
  bank: string | null;
  jobHint: string | null;
  extractedText: string | null;
  confidence: number;
  lowConfidence: boolean;
  jobGuessed: boolean;
};

type Suggestion = {
  paymentType: string;
  priorTotal: number;
  priorCount: number;
  contractValue: number | null;
  remainingAfter: number | null;
};

type ScanResponse = {
  status: "scanned" | "needs_job";
  scan: Scan;
  job: { id: string; label: string } | null;
  suggestion: Suggestion | null;
};

type Filed = {
  status: "filed";
  payer: string | null;
  amount: number;
  paymentType: string;
  project: string;
  needsReview: boolean;
  reviewReason: string | null;
};

const PAYMENT_TYPES = [
  { key: "deposit", label: "Deposit" },
  { key: "progress", label: "Progress" },
  { key: "draw", label: "Draw" },
  { key: "change_order", label: "Change order" },
  { key: "retainage", label: "Retainage" },
  { key: "final", label: "Final" },
] as const;

const METHODS = [
  { key: "check", label: "Check" },
  { key: "wire", label: "Wire" },
  { key: "ach", label: "ACH" },
  { key: "zelle", label: "Zelle" },
  { key: "credit_card", label: "Card" },
  { key: "cash", label: "Cash" },
] as const;

const money = (n: number | null): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "no amount";

const todayISO = (): string => new Date().toISOString().slice(0, 10);

export function DepositCapture() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<false | "scanning" | "filing">(false);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [result, setResult] = useState<Filed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const [pickingJob, setPickingJob] = useState(false);
  const [jobs, setJobs] = useState<ClockInJob[]>([]);
  const [jobQuery, setJobQuery] = useState("");

  // The confirm screen is editable — a handwritten check is exactly the kind of
  // thing a model gets 90% right, and the office should not have to go fix it
  // in the ledger afterwards.
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<string>("check");
  const [paymentType, setPaymentType] = useState<string>("deposit");
  const [memo, setMemo] = useState("");

  const open = Boolean(scan || result || busy || error || manual);

  useEffect(() => {
    if (!pickingJob) return;
    let cancelled = false;
    const t = setTimeout(
      () => {
        searchActiveJobs(jobQuery)
          .then((rows) => {
            if (!cancelled) setJobs(rows);
          })
          .catch(() => {
            if (!cancelled) setJobs([]);
          });
      },
      jobQuery ? 220 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pickingJob, jobQuery]);

  function applyScan(next: ScanResponse) {
    setScan(next);
    setAmount(next.scan.amount === null ? "" : String(next.scan.amount));
    setPayer(next.scan.payer ?? "");
    setCheckNumber(next.scan.checkNumber ?? "");
    setDate(next.scan.date ?? todayISO());
    setMethod(next.scan.method ?? "check");
    setMemo(next.scan.memo ?? "");
    if (next.suggestion?.paymentType) setPaymentType(next.suggestion.paymentType);
    setPickingJob(next.status === "needs_job");
  }

  async function runScan(body: FormData) {
    setBusy("scanning");
    setError(null);
    try {
      const response = await fetch("/api/deposits/capture", { method: "POST", body });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error || "That didn't go through. Try again.");
        setScan(null);
        return;
      }
      applyScan(json as ScanResponse);
    } catch {
      setError("No connection. The photo didn't send — try again in better signal.");
      setScan(null);
    } finally {
      setBusy(false);
    }
  }

  async function onPick(file: File) {
    // Always hand the server a JPEG: HEIC off an iPhone can't be read by the
    // vision model, and a full-size photo stalls the upload.
    let blob: Blob = file;
    try {
      blob = await compressImage(file);
    } catch {
      // Undecodable — send the original and let the route explain.
    }
    const body = new FormData();
    body.append("file", new File([blob], "payment.jpg", { type: blob.type || "image/jpeg" }));
    void runScan(body);
  }

  function chooseJob(projectId: string, label: string) {
    setPickingJob(false);
    // Manual entry has no photo to re-read, so the job is just set locally.
    if (!scan || manual) {
      setScan((prev) => ({
        status: "scanned",
        scan:
          prev?.scan ??
          ({
            storagePath: "",
            documentType: "other",
            payer: null,
            amount: null,
            checkNumber: null,
            date: null,
            method: null,
            memo: null,
            bank: null,
            jobHint: null,
            extractedText: null,
            confidence: 1,
            lowConfidence: false,
            jobGuessed: false,
          } as Scan),
        job: { id: projectId, label },
        suggestion: prev?.suggestion ?? null,
      }));
      return;
    }
    const body = new FormData();
    body.append("storagePath", scan.scan.storagePath);
    body.append("projectId", projectId);
    void runScan(body);
  }

  const parsedAmount = Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  async function confirm() {
    if (!scan?.job || !amountValid) return;
    setBusy("filing");
    setError(null);
    try {
      const s = scan.scan;
      const response = await fetch("/api/deposits/capture/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: s.storagePath || null,
          projectId: scan.job.id,
          amount: parsedAmount,
          payer: payer.trim() || null,
          checkNumber: checkNumber.trim() || null,
          date,
          method,
          paymentType,
          memo: memo.trim() || null,
          extractedText: s.extractedText,
          lowConfidence: s.lowConfidence,
          jobGuessed: s.jobGuessed,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error || "Could not file that payment.");
        return;
      }
      setResult(json as Filed);
      setScan(null);
      setManual(false);
      router.refresh();
    } catch {
      setError("No connection — nothing was filed. Try again in better signal.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setScan(null);
    setResult(null);
    setError(null);
    setManual(false);
    setPickingJob(false);
    setJobQuery("");
    setJobs([]);
    setAmount("");
    setPayer("");
    setCheckNumber("");
    setDate(todayISO());
    setMethod("check");
    setPaymentType("deposit");
    setMemo("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function startManual() {
    close();
    setManual(true);
    setPickingJob(true);
  }

  return (
    <>
      {/* No `capture` attribute — the phone then offers Photo Library as well
          as the camera, so a check already photographed works. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPick(file);
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition active:scale-[0.99]"
        style={{
          background: "linear-gradient(180deg, rgba(16,185,129,0.07), rgba(0,0,0,0))",
          border: "1px solid rgba(16,185,129,0.28)",
        }}
        aria-label="Log a deposit — photograph the check"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: "rgba(16,185,129,0.16)", color: "#34d399" }}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-[18px] h-[18px]"
          >
            <rect x="2" y="5" width="16" height="10" rx="2" />
            <circle cx="10" cy="10" r="2.2" />
            <path d="M5 8.5v3M15 8.5v3" strokeLinecap="round" />
          </svg>
        </span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[14px] font-medium" style={{ color: v("ink") }}>
            Log a deposit
          </span>
          <span className="text-[11px] truncate" style={{ color: v("quiet") }}>
            Photo of the check — it reads it and finds the job
          </span>
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.72)" }}
          onClick={busy ? undefined : close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92dvh] overflow-hidden"
            style={{ background: v("card"), border: `1px solid ${v("line")}`, color: v("ink") }}
          >
            <div
              className="flex items-center justify-between px-5 py-4 shrink-0"
              style={{ borderBottom: `1px solid ${v("line")}` }}
            >
              <div
                className="text-[11px] font-medium uppercase"
                style={{ color: v("quiet"), letterSpacing: "0.18em" }}
              >
                {busy === "scanning" ? "Reading" : result ? "Done" : "Payment received"}
              </div>
              {!busy && (
                <button
                  type="button"
                  onClick={close}
                  className="text-[13px] px-2 py-1 rounded-lg"
                  style={{ color: v("muted") }}
                >
                  Close
                </button>
              )}
            </div>

            <div className="px-5 py-5 overflow-y-auto">
              {busy && (
                <div className="flex items-center gap-3">
                  <span
                    className="h-4 w-4 rounded-full animate-spin"
                    style={{ border: `2px solid ${v("line")}`, borderTopColor: v("accent") }}
                  />
                  <span className="text-[14px]" style={{ color: v("muted") }}>
                    {busy === "scanning" ? "Reading the check…" : "Filing it…"}
                  </span>
                </div>
              )}

              {!busy && error && (
                <div className="flex flex-col gap-3">
                  <div className="text-[14px]" style={{ color: "#F87171" }}>
                    {error}
                  </div>
                  <button
                    onClick={() => {
                      close();
                      setTimeout(() => inputRef.current?.click(), 60);
                    }}
                    className="w-full rounded-xl py-2.5 text-[14px] font-semibold"
                    style={{ background: v("accent"), color: "#1a0f00" }}
                  >
                    Try another photo
                  </button>
                  <button
                    onClick={startManual}
                    className="w-full text-[13px] py-1"
                    style={{ color: v("quiet") }}
                  >
                    Enter it by hand instead
                  </button>
                </div>
              )}

              {/* ---------- Job picker ---------- */}
              {!busy && !error && pickingJob && (
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="text-[15px] font-semibold">
                      {scan?.scan.payer || "Which job?"}
                      {scan?.scan.amount != null && ` · ${money(scan.scan.amount)}`}
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ color: v("quiet") }}>
                      {scan?.scan.jobHint
                        ? `It read "${scan.scan.jobHint}" — which job is that?`
                        : "Which job is this payment for?"}
                    </div>
                  </div>
                  <input
                    value={jobQuery}
                    onChange={(e) => setJobQuery(e.target.value)}
                    placeholder="Search jobs"
                    className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none"
                    style={{
                      background: v("bg-2"),
                      border: `1px solid ${v("line")}`,
                      color: v("ink"),
                    }}
                  />
                  <div className="flex flex-col gap-1.5">
                    {jobs.map((job) => (
                      <button
                        key={job.id}
                        onClick={() =>
                          chooseJob(
                            job.id,
                            [job.project_number, job.name].filter(Boolean).join(" "),
                          )
                        }
                        className="w-full text-left rounded-xl px-3 py-2.5 transition active:scale-[0.99]"
                        style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                      >
                        <div className="text-[14px] font-medium truncate">{job.name}</div>
                        <div className="text-[11px] truncate" style={{ color: v("quiet") }}>
                          {[job.project_number, job.address, job.city].filter(Boolean).join(" · ")}
                        </div>
                      </button>
                    ))}
                    {jobs.length === 0 && (
                      <div className="text-[13px] py-2" style={{ color: v("quiet") }}>
                        No jobs match that.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ---------- The read ---------- */}
              {!busy && !error && !pickingJob && scan?.job && (
                <div className="flex flex-col gap-4">
                  <div>
                    <div
                      className="text-[10px] uppercase mb-1"
                      style={{ color: v("quiet"), letterSpacing: "0.16em" }}
                    >
                      Amount received
                    </div>
                    <input
                      value={amount}
                      inputMode="decimal"
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-xl px-3 py-2.5 text-[26px] font-semibold tracking-tight outline-none"
                      style={{
                        background: v("bg-2"),
                        border: `1px solid ${amountValid ? v("line") : "rgba(248,113,113,0.5)"}`,
                        color: v("ink"),
                      }}
                    />
                  </div>

                  {scan.scan.lowConfidence && (
                    <div
                      className="rounded-xl px-3 py-2 text-[12px]"
                      style={{
                        background: "rgba(217,119,6,0.12)",
                        border: "1px solid rgba(217,119,6,0.3)",
                        color: "#FBBF24",
                      }}
                    >
                      Handwriting was hard to read — check the amount before you confirm.
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setPickingJob(true);
                      setJobQuery("");
                    }}
                    className="w-full text-left rounded-xl px-3 py-2.5"
                    style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                  >
                    <div
                      className="text-[10px] uppercase"
                      style={{ color: v("quiet"), letterSpacing: "0.16em" }}
                    >
                      Job {scan.scan.jobGuessed ? "· guessed from the check" : ""}
                    </div>
                    <div className="text-[14px] font-medium mt-0.5 truncate">{scan.job.label}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: v("accent") }}>
                      Tap to change
                    </div>
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="From">
                      <input
                        value={payer}
                        onChange={(e) => setPayer(e.target.value)}
                        placeholder="Client name"
                        className="w-full bg-transparent text-[14px] outline-none"
                        style={{ color: v("ink") }}
                      />
                    </Field>
                    <Field label="Check #">
                      <input
                        value={checkNumber}
                        onChange={(e) => setCheckNumber(e.target.value)}
                        placeholder="—"
                        className="w-full bg-transparent text-[14px] outline-none"
                        style={{ color: v("ink") }}
                      />
                    </Field>
                    <Field label="Received">
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full bg-transparent text-[14px] outline-none"
                        style={{ color: v("ink") }}
                      />
                    </Field>
                    <Field label="Method">
                      <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                        className="w-full bg-transparent text-[14px] outline-none"
                        style={{ color: v("ink") }}
                      >
                        {METHODS.map((m) => (
                          <option key={m.key} value={m.key} style={{ color: "#000" }}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div>
                    <div
                      className="text-[10px] uppercase mb-2"
                      style={{ color: v("quiet"), letterSpacing: "0.16em" }}
                    >
                      What kind of payment
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PAYMENT_TYPES.map((t) => {
                        const on = paymentType === t.key;
                        return (
                          <button
                            key={t.key}
                            onClick={() => setPaymentType(t.key)}
                            className="rounded-full px-3 py-1.5 text-[12px] font-medium transition active:scale-95"
                            style={{
                              background: on ? "rgba(16,185,129,0.16)" : v("bg-2"),
                              border: `1px solid ${on ? "rgba(16,185,129,0.45)" : v("line")}`,
                              color: on ? "#34d399" : v("muted"),
                            }}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                    {scan.suggestion && (
                      <div className="text-[11px] mt-2" style={{ color: v("quiet") }}>
                        {scan.suggestion.priorCount === 0
                          ? "First money in on this job."
                          : `${money(scan.suggestion.priorTotal)} received so far on this job.`}
                        {scan.suggestion.remainingAfter !== null &&
                          ` ${money(Math.max(scan.suggestion.remainingAfter, 0))} left on the contract after this.`}
                      </div>
                    )}
                  </div>

                  <Field label="Memo">
                    <input
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="What the client wrote on it"
                      className="w-full bg-transparent text-[14px] outline-none"
                      style={{ color: v("ink") }}
                    />
                  </Field>

                  <button
                    onClick={confirm}
                    disabled={!amountValid}
                    className="w-full rounded-xl py-3 text-[15px] font-semibold transition active:scale-[0.99] disabled:opacity-50"
                    style={{ background: v("accent"), color: "#1a0f00" }}
                  >
                    {amountValid ? `File ${money(parsedAmount)}` : "Enter an amount"}
                  </button>
                  {scan.scan.storagePath ? (
                    <button
                      onClick={() => {
                        close();
                        setTimeout(() => inputRef.current?.click(), 60);
                      }}
                      className="w-full text-[13px] py-1"
                      style={{ color: v("quiet") }}
                    >
                      Retake the photo
                    </button>
                  ) : null}
                </div>
              )}

              {/* ---------- Result ---------- */}
              {!busy && !error && result && (
                <div className="flex flex-col gap-2">
                  <div className="text-[22px] font-semibold tracking-tight">
                    {money(result.amount)}
                  </div>
                  <div className="text-[14px]" style={{ color: v("muted") }}>
                    {result.payer ? `${result.payer} → ` : ""}
                    {result.project}
                  </div>
                  <div
                    className="mt-2 rounded-xl px-3 py-2.5 text-[12px]"
                    style={{
                      background: result.needsReview
                        ? "rgba(217,119,6,0.12)"
                        : "rgba(34,197,94,0.10)",
                      border: `1px solid ${result.needsReview ? "rgba(217,119,6,0.3)" : "rgba(34,197,94,0.25)"}`,
                      color: result.needsReview ? "#FBBF24" : "#4ADE80",
                    }}
                  >
                    {result.needsReview
                      ? `Filed, and flagged for the office — ${result.reviewReason}`
                      : `Filed as a ${result.paymentType.replace(/_/g, " ")} against the job. Nicole and Ryan have been told.`}
                  </div>
                </div>
              )}
            </div>

            {!busy && !result && !error && (
              <div className="px-5 pb-4 shrink-0">
                <button
                  onClick={startManual}
                  className="w-full text-[12px] py-1"
                  style={{ color: v("quiet") }}
                >
                  No paper to photograph? Enter a wire or Zelle by hand
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl px-3 py-2"
      style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
    >
      <div
        className="text-[10px] uppercase mb-0.5"
        style={{ color: v("quiet"), letterSpacing: "0.16em" }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
