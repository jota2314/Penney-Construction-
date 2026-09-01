"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v } from "@/components/field-feed/tokens";
import { compressImage } from "@/lib/image/compress";
import { searchActiveJobs, type ClockInJob } from "@/lib/actions/daily-logs";

/**
 * "Scan a receipt" — the crew-facing front door to field invoice capture.
 *
 * Pick a photo (camera OR the library — a receipt is often already in the
 * camera roll), it gets shrunk in the browser, and Claude reads it. The scan
 * writes nothing: you see the vendor, the total, the items it found and which
 * budget lines it wants to charge, and only then does Confirm file it.
 *
 * A store run that mixed trades comes back as several allocations and files as
 * a split invoice — one row per budget line.
 */

type ScannedItem = { description: string; amount: number | null; trade: string | null };

type Scan = {
  storagePath: string;
  documentType: string;
  filename?: string | null;
  quoteReason?: string | null;
  vendor: string;
  amount: number | null;
  invoiceNumber: string | null;
  date: string | null;
  trade: string | null;
  summary: string | null;
  items: ScannedItem[];
  jobHint: string | null;
  extractedText: string | null;
  confidence: number;
  lowConfidence: boolean;
  jobGuessed: boolean;
  chargedToAccount?: boolean;
  isCredit?: boolean;
  creditReason?: string | null;
  fuelAutoRouted?: boolean;
};

type Allocation = {
  lineItemId: string;
  lineLabel: string;
  trade: string | null;
  amount: number;
  note: string | null;
};

type BudgetLine = { id: string; description: string; trade: string | null };

type ScanResponse = {
  status: "scanned" | "needs_job";
  scan: Scan;
  job: { id: string; label: string } | null;
  allocations: Allocation[];
  budgetLines?: BudgetLine[];
};

type Filed = {
  status: "filed";
  vendor: string;
  amount: number | null;
  project: string;
  splitCount: number;
  needsReview: boolean;
  reviewReason: string | null;
};
type Documented = {
  status: "document";
  vendor: string;
  project: string;
  kind?: "quote";
  note?: string | null;
};

const money = (n: number | null): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "no total";

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function ReceiptCapture() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<false | "scanning" | "filing">(false);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [result, setResult] = useState<Filed | Documented | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<
    "credit_card" | "check" | "cash" | "on_account"
  >("credit_card");
  const [pickingJob, setPickingJob] = useState(false);
  const [jobs, setJobs] = useState<ClockInJob[]>([]);
  const [jobQuery, setJobQuery] = useState("");
  const [showItems, setShowItems] = useState(false);

  // The job's budget lines, so a wrong "Charged to" can be re-pointed or the
  // receipt split across more lines right on the phone before confirming.
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [linePicker, setLinePicker] = useState<null | { mode: "move"; index: number } | { mode: "add" }>(null);
  const [lineQuery, setLineQuery] = useState("");

  const open = Boolean(scan || result || busy || error);

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
    setBusy("scanning");
    setError(null);
    try {
      const response = await fetch("/api/crew/field-capture", { method: "POST", body });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error || "That didn't go through. Try again.");
        setScan(null);
        return;
      }
      const next = json as ScanResponse;
      setScan(next);
      setAllocations(next.allocations ?? []);
      setBudgetLines(next.budgetLines ?? []);
      setLinePicker(null);
      setLineQuery("");
      setPickingJob(next.status === "needs_job");
      // A house-account ticket was signed for, not paid — default the chip so
      // it files unpaid unless the crew member says otherwise.
      setPaymentMethod(next.scan?.chargedToAccount ? "on_account" : "credit_card");
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
    body.append("file", new File([blob], "receipt.jpg", { type: blob.type || "image/jpeg" }));
    void runScan(body);
  }

  function chooseJob(projectId: string) {
    if (!scan) return;
    setPickingJob(false);
    const body = new FormData();
    body.append("storagePath", scan.scan.storagePath);
    body.append("projectId", projectId);
    void runScan(body);
  }

  async function confirm() {
    if (!scan?.job) return;
    setBusy("filing");
    setError(null);
    try {
      const s = scan.scan;
      const response = await fetch("/api/crew/field-capture/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: s.storagePath,
          projectId: scan.job.id,
          documentType: s.documentType,
          filename: s.filename,
          vendor: s.vendor,
          amount: s.amount,
          invoiceNumber: s.invoiceNumber,
          date: s.date,
          trade: s.trade,
          summary: s.summary,
          extractedText: s.extractedText,
          lowConfidence: s.lowConfidence,
          paymentMethod,
          allocations: allocations.map((a) => ({
            lineItemId: a.lineItemId,
            amount: a.amount,
            note: a.note,
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error || "Could not file that.");
        return;
      }
      setResult(json as Filed | Documented);
      setScan(null);
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
    setAllocations([]);
    setBudgetLines([]);
    setLinePicker(null);
    setLineQuery("");
    setError(null);
    setPickingJob(false);
    setJobQuery("");
    setJobs([]);
    setShowItems(false);
    setPaymentMethod("credit_card");
    if (inputRef.current) inputRef.current.value = "";
  }

  function retake() {
    close();
    setTimeout(() => inputRef.current?.click(), 60);
  }

  const total = scan?.scan.amount ?? 0;
  const assigned = round2(allocations.reduce((s, a) => s + a.amount, 0));
  const balanced = Math.abs(assigned - total) < 0.011;

  // Lines still free to charge — the current row's own line stays pickable
  // when moving so backing out of a change is harmless.
  const usedLineIds = new Set(allocations.map((a) => a.lineItemId));
  const pickableLines = budgetLines.filter((l) => {
    if (linePicker?.mode === "move" && allocations[linePicker.index]?.lineItemId === l.id) {
      return true;
    }
    if (usedLineIds.has(l.id)) return false;
    if (!lineQuery.trim()) return true;
    return `${l.description} ${l.trade ?? ""}`.toLowerCase().includes(lineQuery.trim().toLowerCase());
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
      // New split row starts at whatever is still unassigned, so a 2-way split
      // is one tap plus typing nothing.
      // Signed, not clamped — a return slip's remainder is negative.
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
    <>
      {/* No `capture` attribute — the phone then offers Photo Library as well
          as the camera, so a receipt already in the camera roll works. */}
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
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition active:scale-[0.99]"
        style={{
          background: "linear-gradient(180deg, rgba(217,119,6,0.07), rgba(0,0,0,0))",
          border: "1px solid rgba(217,119,6,0.28)",
        }}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: "rgba(217,119,6,0.16)" }}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-[18px] h-[18px]"
            style={{ color: v("accent") }}
          >
            <path d="M5 2.5h10a.5.5 0 0 1 .5.5v14l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-1 .6V3a.5.5 0 0 1 .5-.5z" />
            <path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" strokeLinecap="round" />
          </svg>
        </span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[14px] font-medium" style={{ color: v("ink") }}>
            Scan a receipt
          </span>
          <span className="text-[11px] truncate" style={{ color: v("quiet") }}>
            Photo or camera roll — it reads it and finds the job
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
                {busy === "scanning" ? "Scanning" : result ? "Done" : "Receipt"}
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
                    {busy === "scanning" ? "Reading the receipt…" : "Filing it…"}
                  </span>
                </div>
              )}

              {!busy && error && (
                <div className="flex flex-col gap-3">
                  <div className="text-[14px]" style={{ color: "#F87171" }}>
                    {error}
                  </div>
                  <button
                    onClick={retake}
                    className="w-full rounded-xl py-2.5 text-[14px] font-semibold"
                    style={{ background: v("accent"), color: "#1a0f00" }}
                  >
                    Try another photo
                  </button>
                </div>
              )}

              {/* ---------- Job picker ---------- */}
              {!busy && !error && scan && pickingJob && (
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="text-[15px] font-semibold">
                      {scan.scan.vendor} · {money(scan.scan.amount)}
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ color: v("quiet") }}>
                      {scan.scan.jobHint
                        ? `It read "${scan.scan.jobHint}" — which job is that?`
                        : "Which job is this for?"}
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
                        onClick={() => chooseJob(job.id)}
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
              {!busy && !error && scan && !pickingJob && scan.job && (
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="text-[28px] font-semibold tracking-tight leading-none">
                      {money(scan.scan.amount)}
                    </div>
                    <div className="text-[15px] mt-1.5">{scan.scan.vendor}</div>
                    <div className="text-[12px] mt-0.5" style={{ color: v("quiet") }}>
                      {[scan.scan.date, scan.scan.invoiceNumber && `#${scan.scan.invoiceNumber}`]
                        .filter(Boolean)
                        .join(" · ") || "no date on it"}
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

                  {scan.scan.fuelAutoRouted && (
                    <div
                      className="rounded-xl px-3 py-2 text-[12px]"
                      style={{
                        background: "rgba(16,185,129,0.10)",
                        border: "1px solid rgba(16,185,129,0.3)",
                        color: "#34d399",
                      }}
                    >
                      Read as a gas fill-up — charged to company overhead, not a job. Tap the
                      job below if that&apos;s wrong.
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
                      Job {scan.scan.jobGuessed ? "· guessed from the receipt" : ""}
                    </div>
                    <div className="text-[14px] font-medium mt-0.5 truncate">{scan.job.label}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: v("accent") }}>
                      Tap to change
                    </div>
                  </button>

                  {scan.scan.items.length > 0 && (
                    <div>
                      <button
                        onClick={() => setShowItems((s) => !s)}
                        className="flex items-center justify-between w-full"
                      >
                        <span
                          className="text-[10px] uppercase"
                          style={{ color: v("quiet"), letterSpacing: "0.16em" }}
                        >
                          What it read · {scan.scan.items.length} items
                        </span>
                        <span className="text-[11px]" style={{ color: v("accent") }}>
                          {showItems ? "Hide" : "Show"}
                        </span>
                      </button>
                      {showItems && (
                        <div className="flex flex-col gap-1 mt-2">
                          {scan.scan.items.map((item, i) => (
                            <div key={i} className="flex items-start justify-between gap-3">
                              <span className="text-[12px] min-w-0 flex-1">
                                {item.description}
                                {item.trade && (
                                  <span style={{ color: v("quiet") }}> · {item.trade}</span>
                                )}
                              </span>
                              <span
                                className="text-[12px] shrink-0"
                                style={{ color: v("muted") }}
                              >
                                {item.amount === null ? "—" : money(item.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <div
                      className="text-[10px] uppercase mb-2"
                      style={{ color: v("quiet"), letterSpacing: "0.16em" }}
                    >
                      Charged to
                    </div>

                    {linePicker ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[12px]" style={{ color: v("muted") }}>
                            {linePicker.mode === "move"
                              ? "Pick the right budget line"
                              : "Pick a line to split to"}
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
                          style={{
                            background: v("bg-2"),
                            border: `1px solid ${v("line")}`,
                            color: v("ink"),
                          }}
                        />
                        <div className="flex flex-col gap-1 max-h-56 overflow-auto">
                          {pickableLines.map((l) => (
                            <button
                              key={l.id}
                              onClick={() => applyLinePick(l)}
                              className="w-full text-left rounded-xl px-3 py-2.5 transition active:scale-[0.99]"
                              style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                            >
                              <div className="text-[13px] font-medium truncate">{l.description}</div>
                              {l.trade && (
                                <div className="text-[11px] truncate" style={{ color: v("quiet") }}>
                                  {l.trade}
                                </div>
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
                            style={{
                              background: v("bg-2"),
                              border: `1px solid ${v("line")}`,
                              color: v("muted"),
                            }}
                          >
                            No budget line matched. Pick one below, or it files to the job
                            unassigned and the office places it.
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
                              <div className="text-[13px] font-medium truncate">{a.lineLabel}</div>
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
                                    pi === i
                                      ? { ...p, amount: Number.isFinite(next) ? next : 0 }
                                      : p,
                                  ),
                                );
                              }}
                              className="w-20 shrink-0 rounded-lg px-2 py-1.5 text-[13px] text-right outline-none"
                              style={{
                                background: v("card"),
                                border: `1px solid ${v("line")}`,
                                color: v("ink"),
                              }}
                            />
                            <button
                              onClick={() =>
                                setAllocations((prev) => prev.filter((_, pi) => pi !== i))
                              }
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
                            {allocations.length === 0
                              ? "+ Charge to a budget line"
                              : "+ Split to another line"}
                          </button>
                        )}
                        {!balanced && allocations.length > 0 && (
                          <div className="text-[11px] px-1" style={{ color: "#FBBF24" }}>
                            {money(assigned)} of {money(total)} assigned — fix it, or it files
                            unassigned for the office.
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

                  {scan.scan.documentType === "quote" && (
                    <div
                      className="rounded-xl px-3 py-2.5 text-[12px]"
                      style={{
                        background: "rgba(217,119,6,0.12)",
                        border: "1px solid rgba(217,119,6,0.3)",
                        color: "#FBBF24",
                      }}
                    >
                      This reads as a QUOTE
                      {scan.scan.quoteReason ? ` — ${scan.scan.quoteReason}` : ""}. It files with
                      the job&apos;s quotes, not as money spent.
                    </div>
                  )}

                  {scan.scan.isCredit && (
                    <div
                      className="rounded-xl px-3 py-2 text-[12.5px]"
                      style={{
                        background: "rgba(34,197,94,0.12)",
                        border: "1px solid rgba(34,197,94,0.3)",
                        color: "#4ADE80",
                      }}
                    >
                      This is a CREDIT
                      {scan.scan.creditReason ? ` — ${scan.scan.creditReason}` : ""}. It books
                      as money coming back, so the budget line goes DOWN.
                    </div>
                  )}

                  {scan.scan.documentType !== "delivery_ticket" &&
                    scan.scan.documentType !== "quote" &&
                    scan.scan.amount !== null && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] shrink-0" style={{ color: v("quiet") }}>
                        Paid with
                      </span>
                      {(
                        [
                          ["credit_card", "Company card"],
                          ["check", "Check"],
                          ["cash", "Cash"],
                          ["on_account", "On the account"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setPaymentMethod(value)}
                          className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition"
                          style={
                            paymentMethod === value
                              ? { background: v("accent"), color: "#1a0f00" }
                              : {
                                  background: v("bg-2"),
                                  border: `1px solid ${v("line")}`,
                                  color: v("quiet"),
                                }
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={confirm}
                    className="w-full rounded-xl py-3 text-[15px] font-semibold transition active:scale-[0.99]"
                    style={{ background: v("accent"), color: "#1a0f00" }}
                  >
                    {scan.scan.documentType === "quote"
                      ? "File as a quote"
                      : scan.scan.documentType === "delivery_ticket" || scan.scan.amount === null
                        ? "File as delivery ticket"
                        : scan.scan.isCredit
                          ? "Confirm and file the credit"
                          : "Confirm and file"}
                  </button>
                  <button
                    onClick={retake}
                    className="w-full text-[13px] py-1"
                    style={{ color: v("quiet") }}
                  >
                    Retake the photo
                  </button>
                </div>
              )}

              {/* ---------- Result ---------- */}
              {!busy && !error && result?.status === "filed" && (
                <div className="flex flex-col gap-2">
                  <div className="text-[22px] font-semibold tracking-tight">
                    {money(result.amount)}
                  </div>
                  <div className="text-[14px]" style={{ color: v("muted") }}>
                    {result.vendor} → {result.project}
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
                      : result.splitCount > 1
                        ? `Filed across ${result.splitCount} budget lines.`
                        : "Filed to the job's budget. Nothing else needed."}
                  </div>
                </div>
              )}

              {!busy && !error && result?.status === "document" && (
                <div className="flex flex-col gap-2">
                  <div className="text-[16px] font-semibold">
                    {result.kind === "quote" ? "Quote saved — not billed" : "Delivery ticket saved"}
                  </div>
                  <div className="text-[14px]" style={{ color: v("muted") }}>
                    {result.vendor} → {result.project}
                  </div>
                  <div className="text-[12px] mt-1" style={{ color: v("quiet") }}>
                    {result.kind === "quote"
                      ? `That's a price offered, not money spent${result.note ? ` — ${result.note}` : ""}. It's filed with the job's quotes for the office.`
                      : "No dollar total on it, so it's filed with the job's paperwork instead of the budget."}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
