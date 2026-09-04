"use client";

import { useEffect, useRef, useState } from "react";
import { v } from "@/components/field-feed/tokens";
import { BillUploadError, buildScanForm, readJsonResponse } from "@/lib/image/bill-upload";
import { searchActiveJobs, type ClockInJob } from "@/lib/actions/daily-logs";

/**
 * Bill intake for the Command Center Receipts sheet. Drop a photo OR a PDF —
 * the AI reads it and proposes everything (vendor, total, job, budget lines,
 * paid or A/P), then a person confirms before ANYTHING books. The confirm
 * card lets them re-point the job, move an allocation to a different budget
 * line, remove rows, or split across more lines — same controls as the crew
 * scanner.
 *
 * Same pipeline as /invoices "Add a bill" (/api/bills/scan + /api/bills/commit).
 */

type Allocation = {
  lineItemId: string;
  lineLabel: string;
  trade: string | null;
  amount: number;
  note: string | null;
};

type BudgetLine = { id: string; description: string; trade: string | null };

type ScanResult = {
  status: "scanned" | "needs_job";
  scan: {
    storagePath: string;
    documentType: string;
    vendor: string;
    amount: number | null;
    invoiceNumber: string | null;
    date: string | null;
    dueDate: string | null;
    trade: string | null;
    summary: string | null;
    jobHint?: string | null;
    extractedText: string | null;
    lowConfidence?: boolean;
    jobGuessed?: boolean;
    alreadyPaid?: boolean;
    isCredit?: boolean;
    creditReason?: string | null;
    fuelAutoRouted?: boolean;
  };
  job: { id: string; label: string } | null;
  allocations: Allocation[];
  budgetLines?: BudgetLine[];
};

const money = (n: number | null): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "no total";

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function BillDrop({ onFiled }: { onFiled?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "reading" | "filing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [linePicker, setLinePicker] = useState<
    null | { mode: "move"; index: number } | { mode: "add" }
  >(null);
  const [lineQuery, setLineQuery] = useState("");
  const [pickingJob, setPickingJob] = useState(false);
  const [jobs, setJobs] = useState<ClockInJob[]>([]);
  const [jobQuery, setJobQuery] = useState("");
  // Default ON: the person filing the bill is the one who knows it's good,
  // and making them come back to a second screen is what left bills sitting
  // unapproved. Untick to file it as A/P for someone else to clear.
  const [approveOnFile, setApproveOnFile] = useState(true);
  const [done, setDone] = useState<{
    vendor: string;
    amount: number;
    paid: boolean;
    project: string | null;
    needsReview: boolean;
    invoiceId: string;
    approvedForPay: boolean;
    approvalDenied: boolean;
  } | null>(null);

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

  async function runScan(body: FormData) {
    setError(null);
    setDone(null);
    setPhase("reading");
    try {
      const res = await fetch("/api/bills/scan", { method: "POST", body });
      const { ok, json, error: readError } = await readJsonResponse<ScanResult>(res);
      if (!ok || !json) {
        setError(readError || "Could not read that file.");
        setScan(null);
        return;
      }
      const next = json as ScanResult;
      setScan(next);
      setAllocations(next.allocations ?? []);
      setBudgetLines(next.budgetLines ?? []);
      setLinePicker(null);
      setLineQuery("");
      setPickingJob(next.status === "needs_job");
    } catch {
      setError("Upload failed — check the connection and try again.");
      setScan(null);
    } finally {
      setPhase("idle");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleFile(file: File) {
    // Photos are downscaled to JPEG and anything still over Vercel's body
    // cap goes straight to storage — see bill-upload.ts.
    let body: FormData;
    try {
      body = await buildScanForm(file);
    } catch (err) {
      setError(err instanceof BillUploadError ? err.message : "Could not prepare that file.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    void runScan(body);
  }

  function chooseJob(projectId: string) {
    if (!scan) return;
    setPickingJob(false);
    setJobQuery("");
    const body = new FormData();
    body.append("storagePath", scan.scan.storagePath);
    body.append("projectId", projectId);
    void runScan(body);
  }

  function discard() {
    setScan(null);
    setAllocations([]);
    setBudgetLines([]);
    setLinePicker(null);
    setLineQuery("");
    setPickingJob(false);
    setJobQuery("");
    setJobs([]);
    setError(null);
  }

  async function confirm() {
    if (!scan) return;
    setPhase("filing");
    setError(null);
    try {
      const s = scan.scan;
      const res = await fetch("/api/bills/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: s.storagePath,
          projectId: scan.job?.id ?? "",
          vendor: s.vendor,
          amount: s.amount,
          invoiceNumber: s.invoiceNumber,
          date: s.date,
          dueDate: s.dueDate,
          summary: s.summary,
          trade: s.trade,
          extractedText: s.extractedText,
          documentType: s.documentType,
          vendorType: s.documentType === "invoice" ? "subcontractor" : "supplier",
          // Receipts were paid at the counter; a PAID-stamped / zero-balance
          // invoice was paid too — file the cost as paid, not as A/P.
          paid: s.documentType === "receipt" || s.alreadyPaid === true,
          paymentMethod:
            s.alreadyPaid && s.documentType !== "receipt" ? "check" : "credit_card",
          allocations: allocations.map((a) => ({
            lineItemId: a.lineItemId,
            amount: a.amount,
            note: a.note,
          })),
          // Clear it for pay in the same tap that files it. The server holds
          // the approver allowlist and refuses an uncoded or flagged bill, so
          // this is a request, not a decision.
          approveForPay: approveOnFile,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Could not file that bill.");
        return;
      }
      setDone({
        vendor: json.vendor,
        amount: json.amount,
        paid: json.paid,
        project: json.project ?? null,
        needsReview: Boolean(json.needsReview),
        invoiceId: json.invoiceId,
        approvedForPay: Boolean(json.approvedForPay),
        approvalDenied: Boolean(json.approvalDenied),
      });
      discard();
      onFiled?.();
    } catch {
      setError("No connection — nothing was filed. Try again.");
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const total = scan?.scan.amount ?? 0;
  const assigned = round2(allocations.reduce((s, a) => s + a.amount, 0));
  const balanced = Math.abs(assigned - total) < 0.011;
  const willFilePaid =
    scan?.scan.documentType === "receipt" || scan?.scan.alreadyPaid === true;

  // Mirrors the server's rule so the checkbox can't promise something the
  // commit route will refuse: A/P only, on a job, fully charged to budget
  // lines. The allowlist itself is enforced server-side.
  const canApproveOnFile =
    !willFilePaid && Boolean(scan?.job) && allocations.length > 0 && balanced;

  const usedLineIds = new Set(allocations.map((a) => a.lineItemId));
  const pickableLines = budgetLines.filter((l) => {
    if (linePicker?.mode === "move" && allocations[linePicker.index]?.lineItemId === l.id) {
      return true;
    }
    if (usedLineIds.has(l.id)) return false;
    if (!lineQuery.trim()) return true;
    return `${l.description} ${l.trade ?? ""}`
      .toLowerCase()
      .includes(lineQuery.trim().toLowerCase());
  });

  function applyLinePick(line: BudgetLine) {
    if (!linePicker) return;
    if (linePicker.mode === "move") {
      const idx = linePicker.index;
      setAllocations((prev) =>
        prev.map((a, i) =>
          i === idx
            ? { ...a, lineItemId: line.id, lineLabel: line.description, trade: line.trade }
            : a,
        ),
      );
    } else {
      // Signed, not clamped at zero — on a credit the remainder is negative
      // and clamping it would file the credit half-assigned.
      const remaining = round2(total - assigned);
      setAllocations((prev) => [
        ...prev,
        {
          lineItemId: line.id,
          lineLabel: line.description,
          trade: line.trade,
          amount: prev.length === 0 ? total : remaining,
          note: null,
        },
      ]);
    }
    setLinePicker(null);
    setLineQuery("");
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy || Boolean(scan)}
        onClick={() => fileRef.current?.click()}
        className="w-full rounded-2xl px-4 py-4 text-left transition active:scale-[0.99] disabled:opacity-80"
        style={{
          background: "rgba(217,119,6,0.10)",
          border: `1.5px dashed ${busy ? "rgba(217,119,6,0.7)" : "rgba(217,119,6,0.45)"}`,
        }}
      >
        <span className="flex items-center gap-3">
          <span
            className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(217,119,6,0.18)", color: v("accent") }}
          >
            {busy ? (
              <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 animate-spin">
                <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth={2} strokeOpacity={0.25} />
                <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3.5 13.5v2a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold" style={{ color: v("ink") }}>
              {phase === "reading"
                ? "Reading it…"
                : phase === "filing"
                  ? "Filing it…"
                  : scan
                    ? "Check the read below"
                    : "Drop a receipt or a bill"}
            </span>
            <span className="block text-[11.5px] mt-0.5" style={{ color: v("quiet") }}>
              {busy
                ? "The AI is reading it — hang on"
                : scan
                  ? "Nothing books until you confirm"
                  : "Photo or PDF — the AI reads it, you confirm."}
            </span>
          </span>
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {/* ---------- Confirm card ---------- */}
      {scan && !busy && (
        <div
          className="rounded-2xl px-4 py-3.5 flex flex-col gap-3"
          style={{ background: v("card"), border: `1px solid ${v("line")}` }}
        >
          <div>
            <div className="text-[22px] font-semibold tracking-tight leading-none" style={{ color: v("ink") }}>
              {money(scan.scan.amount)}
            </div>
            <div className="text-[14px] mt-1" style={{ color: v("ink") }}>{scan.scan.vendor}</div>
            <div className="text-[11.5px] mt-0.5" style={{ color: v("quiet") }}>
              {[
                scan.scan.date,
                scan.scan.invoiceNumber && `#${scan.scan.invoiceNumber}`,
                scan.scan.isCredit ? "CREDIT — books negative" : null,
                willFilePaid ? "files as PAID" : "files as unpaid A/P",
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
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
              Hard to read — check the total before you confirm.
            </div>
          )}

          {scan.scan.isCredit && (
            <div
              className="rounded-xl px-3 py-2 text-[12px]"
              style={{
                background: "rgba(16,185,129,0.10)",
                border: "1px solid rgba(16,185,129,0.3)",
                color: "#34d399",
              }}
            >
              Read as a CREDIT
              {scan.scan.creditReason ? ` — ${scan.scan.creditReason}` : ""}. It books negative
              against the line you pick, so that line&apos;s Spent goes down.
            </div>
          )}

          {scan.scan.fuelAutoRouted && (
            <div
              className="rounded-xl px-3 py-2 text-[12px]"
              style={{
                background: "rgba(16,185,129,0.10)",
                border: "1px solid rgba(16,185,129,0.3)",
                color: "#34d399",
              }}
            >
              Read as a gas fill-up — charged to company overhead, not a job.
            </div>
          )}

          {/* Job */}
          {pickingJob ? (
            <div className="flex flex-col gap-1.5">
              <div className="text-[12px]" style={{ color: v("muted") }}>
                {scan.scan.jobHint
                  ? `It read "${scan.scan.jobHint}" — which job is that?`
                  : "Which job is this for?"}
              </div>
              <input
                value={jobQuery}
                onChange={(e) => setJobQuery(e.target.value)}
                placeholder="Search jobs"
                className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none"
                style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("ink") }}
              />
              <div className="flex flex-col gap-1 max-h-52 overflow-auto">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => chooseJob(job.id)}
                    className="w-full text-left rounded-xl px-3 py-2.5 transition active:scale-[0.99]"
                    style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                  >
                    <div className="text-[13px] font-medium truncate" style={{ color: v("ink") }}>{job.name}</div>
                    <div className="text-[11px] truncate" style={{ color: v("quiet") }}>
                      {[job.project_number, job.address, job.city].filter(Boolean).join(" · ")}
                    </div>
                  </button>
                ))}
                {jobs.length === 0 && (
                  <div className="text-[13px] py-2" style={{ color: v("quiet") }}>No jobs match that.</div>
                )}
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setPickingJob(true);
                setJobQuery("");
              }}
              className="w-full text-left rounded-xl px-3 py-2.5"
              style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
            >
              <div className="text-[10px] uppercase" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>
                Job {scan.scan.jobGuessed ? "· guessed from the bill" : ""}
              </div>
              <div className="text-[13px] font-medium mt-0.5 truncate" style={{ color: v("ink") }}>
                {scan.job?.label ?? "No job — pick one"}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: v("accent") }}>Tap to change</div>
            </button>
          )}

          {/* Charged to */}
          {!pickingJob && scan.scan.amount !== null && (
            <div>
              <div className="text-[10px] uppercase mb-1.5" style={{ color: v("quiet"), letterSpacing: "0.16em" }}>
                Charged to
              </div>
              {linePicker ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[12px]" style={{ color: v("muted") }}>
                      {linePicker.mode === "move" ? "Pick the right budget line" : "Pick a line to split to"}
                    </span>
                    <button
                      onClick={() => {
                        setLinePicker(null);
                        setLineQuery("");
                      }}
                      className="text-[12px]"
                      style={{ color: v("accent") }}
                    >
                      Cancel
                    </button>
                  </div>
                  <input
                    value={lineQuery}
                    onChange={(e) => setLineQuery(e.target.value)}
                    placeholder="Search lines"
                    className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none"
                    style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("ink") }}
                  />
                  <div className="flex flex-col gap-1 max-h-52 overflow-auto">
                    {pickableLines.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => applyLinePick(l)}
                        className="w-full text-left rounded-xl px-3 py-2.5 transition active:scale-[0.99]"
                        style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                      >
                        <div className="text-[13px] font-medium truncate" style={{ color: v("ink") }}>{l.description}</div>
                        {l.trade && (
                          <div className="text-[11px] truncate" style={{ color: v("quiet") }}>{l.trade}</div>
                        )}
                      </button>
                    ))}
                    {pickableLines.length === 0 && (
                      <div className="text-[12px] py-2 px-1" style={{ color: v("quiet") }}>
                        No budget lines match that.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {allocations.length === 0 && (
                    <div
                      className="rounded-xl px-3 py-2.5 text-[12px]"
                      style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("muted") }}
                    >
                      No budget line matched. Pick one below, or it files to the job unassigned
                      and lands in Needs check.
                    </div>
                  )}
                  {allocations.map((a, i) => (
                    <div
                      key={a.lineItemId}
                      className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                      style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                    >
                      <button
                        onClick={() => {
                          setLinePicker({ mode: "move", index: i });
                          setLineQuery("");
                        }}
                        className="min-w-0 flex-1 text-left"
                        disabled={budgetLines.length === 0}
                      >
                        <div className="text-[13px] font-medium truncate" style={{ color: v("ink") }}>{a.lineLabel}</div>
                        <div className="text-[11px] truncate" style={{ color: v("quiet") }}>
                          {a.note ? `${a.note} · ` : ""}
                          {budgetLines.length > 0 && (
                            <span style={{ color: v("accent") }}>Tap to change</span>
                          )}
                        </div>
                      </button>
                      <input
                        value={String(a.amount)}
                        inputMode="decimal"
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setAllocations((prev) =>
                            prev.map((p, pi) =>
                              pi === i ? { ...p, amount: Number.isFinite(next) ? next : 0 } : p,
                            ),
                          );
                        }}
                        className="w-20 shrink-0 rounded-lg px-2 py-1.5 text-[13px] text-right outline-none"
                        style={{ background: v("card"), border: `1px solid ${v("line")}`, color: v("ink") }}
                      />
                      <button
                        onClick={() => setAllocations((prev) => prev.filter((_, pi) => pi !== i))}
                        aria-label="Remove this line"
                        className="shrink-0 px-1 opacity-60"
                        style={{ color: v("muted") }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {budgetLines.length > 0 && pickableLines.length > 0 && (
                    <button
                      onClick={() => {
                        setLinePicker({ mode: "add" });
                        setLineQuery("");
                      }}
                      className="w-full text-left rounded-xl px-3 py-2.5 text-[13px] font-medium"
                      style={{
                        background: "transparent",
                        border: `1px dashed ${v("line")}`,
                        color: v("accent"),
                      }}
                    >
                      {allocations.length === 0 ? "+ Charge to a budget line" : "+ Split to another line"}
                    </button>
                  )}
                  {!balanced && allocations.length > 0 && (
                    <div className="text-[11px] px-1" style={{ color: "#FBBF24" }}>
                      {money(assigned)} of {money(total)} assigned — fix it, or it files
                      unassigned for Needs check.
                    </div>
                  )}
                  {balanced && allocations.length > 1 && (
                    <div className="text-[11px] px-1" style={{ color: v("quiet") }}>
                      Files as {allocations.length} rows, one per budget line.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Approve-on-file. Only for A/P — a paid receipt has nothing to
              approve, and an uncoded bill can't be cleared for pay. */}
          {!pickingJob && !linePicker && !willFilePaid && (
            <button
              type="button"
              onClick={() => setApproveOnFile((prev) => !prev)}
              disabled={!canApproveOnFile}
              aria-pressed={approveOnFile && canApproveOnFile}
              className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left disabled:opacity-60"
              style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
            >
              <span
                aria-hidden
                className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] text-[11px] font-bold"
                style={{
                  background:
                    approveOnFile && canApproveOnFile ? v("accent") : "transparent",
                  border: `1.5px solid ${approveOnFile && canApproveOnFile ? v("accent") : v("line")}`,
                  color: "#1a0f00",
                }}
              >
                {approveOnFile && canApproveOnFile ? "✓" : ""}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium" style={{ color: v("ink") }}>
                  Approve for pay
                </span>
                <span className="block text-[11.5px] mt-0.5" style={{ color: v("quiet") }}>
                  {canApproveOnFile
                    ? "Nicole gets it as good to pay."
                    : "Charge it to a budget line first."}
                </span>
              </span>
            </button>
          )}

          {/* Confirm / discard */}
          {!pickingJob && !linePicker && (
            <div className="flex gap-2">
              <button
                onClick={discard}
                className="rounded-xl px-4 py-2.5 text-[13px] font-medium"
                style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("muted") }}
              >
                Discard
              </button>
              <button
                onClick={() => void confirm()}
                disabled={busy || !scan.job}
                className="flex-1 rounded-xl py-2.5 text-[14px] font-semibold disabled:opacity-50"
                style={{ background: v("accent"), color: "#1a0f00" }}
              >
                {!scan.job
                  ? "Pick a job first"
                  : approveOnFile && canApproveOnFile
                    ? "Confirm & approve for pay"
                    : "Confirm — file it"}
              </button>
            </div>
          )}
        </div>
      )}

      {done && (
        <div
          className="rounded-xl px-3 py-2.5 text-[12.5px]"
          style={{
            background: done.needsReview ? "rgba(217,119,6,0.12)" : "rgba(16,185,129,0.12)",
            border: `1px solid ${done.needsReview ? "rgba(217,119,6,0.35)" : "rgba(16,185,129,0.35)"}`,
            color: v("ink"),
          }}
        >
          <span className="font-semibold">
            {done.vendor} — {money(done.amount)}
          </span>{" "}
          {done.paid
            ? "booked and sent to QuickBooks"
            : done.approvedForPay
              ? "filed and approved for pay"
              : "filed as unpaid"}
          {done.project ? ` on ${done.project}` : ""}.
          {done.approvedForPay && " Nicole has been told it's good to pay."}
          {done.approvalDenied && (
            <span className="block mt-1 font-medium" style={{ color: "#FBBF24" }}>
              Filed, but not approved — only Jorge or Ryan can clear a bill for pay.
            </span>
          )}
          {done.needsReview && (
            <a
              href={`/spent/${done.invoiceId}`}
              className="block mt-1 font-medium"
              style={{ color: "#FBBF24" }}
            >
              Something was off — it&apos;s in Needs check, tap to fix →
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="text-[12px] px-1" style={{ color: "#F87171" }}>
          {error}
        </div>
      )}
    </div>
  );
}
