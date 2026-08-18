"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Upload, FileText, CheckCircle2 } from "lucide-react";
import {
  listBillJobOptions,
  listPayerOptions,
  type BillJobOption,
  type PayerOption,
} from "@/lib/actions/vendor-bills";
import { listBudgetLinesForJob, type CaptureBudgetLine } from "@/lib/actions/field-capture";

/**
 * "Add a bill" — the office intake for anything Penney owes. Ryan gets handed
 * a sub's bill, drops the photo or PDF, the AI reads it and proposes the job
 * and budget line(s); he corrects, says paid-or-not, and files it. Paid bills
 * mirror straight into QuickBooks on the payer's card; unpaid ones sit as
 * A/P until someone marks them paid.
 */

type ScanAllocation = {
  lineItemId: string;
  lineLabel: string;
  trade: string | null;
  amount: number;
  note: string | null;
};

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
    extractedText: string | null;
    lowConfidence: boolean;
  };
  job: { id: string; label: string } | null;
  allocations: ScanAllocation[];
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

const money = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function AddBillDialog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<false | "scanning" | "filing">(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<{ vendor: string; amount: number; paid: boolean } | null>(
    null,
  );

  // form state (prefilled by the scan, editable, or typed from scratch)
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [date, setDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [summary, setSummary] = useState("");
  const [trade, setTrade] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [vendorType, setVendorType] = useState<"subcontractor" | "supplier">("supplier");
  const [projectId, setProjectId] = useState("");
  const [allocations, setAllocations] = useState<ScanAllocation[]>([]);
  const [singleLineId, setSingleLineId] = useState("");
  const [paid, setPaid] = useState(false);
  const [method, setMethod] = useState<"credit_card" | "check" | "cash" | "ach">("credit_card");
  const [paidBy, setPaidBy] = useState("");
  const [entered, setEntered] = useState(false); // form visible (after scan or "by hand")

  const [jobs, setJobs] = useState<BillJobOption[]>([]);
  const [payers, setPayers] = useState<PayerOption[]>([]);
  const [budgetLines, setBudgetLines] = useState<CaptureBudgetLine[]>([]);

  useEffect(() => {
    if (!open) return;
    listBillJobOptions().then(setJobs).catch(() => setJobs([]));
    listPayerOptions().then(setPayers).catch(() => setPayers([]));
  }, [open]);

  // Budget lines follow the chosen job; a job change invalidates AI splits.
  useEffect(() => {
    if (!projectId) {
      setBudgetLines([]);
      return;
    }
    listBudgetLinesForJob(projectId).then(setBudgetLines).catch(() => setBudgetLines([]));
  }, [projectId]);

  function reset() {
    setBusy(false);
    setError(null);
    setFiled(null);
    setStoragePath(null);
    setVendor("");
    setAmount("");
    setInvoiceNumber("");
    setDate("");
    setDueDate("");
    setSummary("");
    setTrade(null);
    setExtractedText(null);
    setVendorType("supplier");
    setProjectId("");
    setAllocations([]);
    setSingleLineId("");
    setPaid(false);
    setMethod("credit_card");
    setPaidBy("");
    setEntered(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function scan(file: File) {
    setBusy("scanning");
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/bills/scan", { method: "POST", body });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error || "Could not read that file.");
        setBusy(false);
        return;
      }
      const result = json as ScanResult;
      setStoragePath(result.scan.storagePath);
      setVendor(result.scan.vendor === "Unknown vendor" ? "" : result.scan.vendor);
      setAmount(result.scan.amount != null ? String(result.scan.amount) : "");
      setInvoiceNumber(result.scan.invoiceNumber ?? "");
      setDate(result.scan.date ?? "");
      setDueDate(result.scan.dueDate ?? "");
      setSummary(result.scan.summary ?? "");
      setTrade(result.scan.trade);
      setExtractedText(result.scan.extractedText);
      setVendorType(result.scan.documentType === "invoice" ? "subcontractor" : "supplier");
      // A register receipt was already paid at the counter; a sub's invoice
      // usually hasn't been.
      setPaid(result.scan.documentType === "receipt");
      if (result.job) setProjectId(result.job.id);
      setAllocations(result.allocations);
      if (result.allocations.length === 1) setSingleLineId(result.allocations[0].lineItemId);
      setEntered(true);
    } catch {
      setError("Upload failed — check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const total = Number(amount) || 0;
  const useSplitUI = allocations.length > 1;
  const assigned = round2(allocations.reduce((s, a) => s + a.amount, 0));
  const splitBalanced = Math.abs(assigned - total) < 0.011;

  async function file() {
    setBusy("filing");
    setError(null);
    try {
      const payload = {
        storagePath,
        projectId,
        vendor: vendor.trim(),
        amount: total,
        invoiceNumber: invoiceNumber.trim() || null,
        date: date || null,
        dueDate: dueDate || null,
        summary: summary.trim() || null,
        trade,
        extractedText,
        vendorType,
        paid,
        paymentMethod: method,
        paidBy: paidBy || null,
        allocations: useSplitUI
          ? allocations.map((a) => ({ lineItemId: a.lineItemId, amount: a.amount, note: a.note }))
          : singleLineId
            ? [{ lineItemId: singleLineId, amount: total, note: null }]
            : [],
      };
      const response = await fetch("/api/bills/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error || "Could not file that bill.");
        return;
      }
      setFiled({ vendor: json.vendor, amount: json.amount, paid: json.paid });
      router.refresh();
    } catch {
      setError("No connection — nothing was filed.");
    } finally {
      setBusy(false);
    }
  }

  const canFile =
    Boolean(projectId) && vendor.trim().length > 0 && total > 0 && (!useSplitUI || splitBalanced);

  const inputCls =
    "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

  return (
    <>
      <Button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        size="sm"
      >
        <Plus className="h-4 w-4 mr-1" />
        Add a bill
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{filed ? "Filed" : "Add a bill"}</DialogTitle>
          </DialogHeader>

          {filed ? (
            <div className="flex flex-col items-start gap-3">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-medium">
                  {filed.vendor} — {money(filed.amount)} {filed.paid ? "booked and sent to QuickBooks" : "filed as unpaid"}
                </span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={reset}>
                  Add another
                </Button>
                <Button size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : busy === "scanning" ? (
            <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Reading the bill…</span>
            </div>
          ) : !entered ? (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed py-10 hover:bg-muted/50 transition-colors"
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">Drop the bill here</span>
                <span className="text-xs text-muted-foreground">
                  Photo or PDF — the AI reads it and fills everything in
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void scan(f);
                }}
              />
              <button
                onClick={() => setEntered(true)}
                className="text-xs text-muted-foreground hover:text-foreground text-center"
              >
                or type it in by hand
              </button>
              {error && <div className="text-sm text-destructive">{error}</div>}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {storagePath && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  File attached — check the read below
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground">Who&apos;s billing us</label>
                  <input
                    className={inputCls}
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    placeholder="Vendor or sub"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Amount</label>
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Invoice #</label>
                  <input
                    className={inputCls}
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Bill date</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">From a</label>
                  <div className="flex gap-1 mt-0.5">
                    {(
                      [
                        ["subcontractor", "Sub"],
                        ["supplier", "Supplier"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setVendorType(value)}
                        className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                          vendorType === value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground">What it&apos;s for</label>
                  <input
                    className={inputCls}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="e.g. rough plumbing, second floor bath"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground">Job</label>
                  <select
                    className={inputCls}
                    value={projectId}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                      setAllocations([]);
                      setSingleLineId("");
                    }}
                  >
                    <option value="">Pick the job…</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.isOverhead ? `🏢 ${j.label} (overhead)` : j.label}
                      </option>
                    ))}
                  </select>
                </div>

                {useSplitUI ? (
                  <div className="col-span-2 flex flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground">
                      Split across budget lines
                    </label>
                    {allocations.map((a, i) => (
                      <div key={a.lineItemId} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs">{a.lineLabel}</span>
                        <input
                          className="w-24 rounded-lg border bg-background px-2 py-1 text-xs text-right"
                          inputMode="decimal"
                          value={String(a.amount)}
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
                        />
                      </div>
                    ))}
                    {!splitBalanced && (
                      <div className="text-[11px] text-amber-600">
                        {money(assigned)} of {money(total)} assigned — fix it, or it files
                        unassigned for review.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground">Budget line</label>
                    <select
                      className={inputCls}
                      value={singleLineId}
                      onChange={(e) => setSingleLineId(e.target.value)}
                      disabled={!projectId}
                    >
                      <option value="">
                        {projectId ? "Pick the line it charges…" : "Pick a job first"}
                      </option>
                      {budgetLines.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.description}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="rounded-xl border p-3 flex flex-col gap-2">
                <div className="flex gap-1">
                  {(
                    [
                      [false, "Not paid yet"],
                      [true, "Already paid"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={label}
                      onClick={() => setPaid(value)}
                      className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                        paid === value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {paid ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Paid with</label>
                      <select
                        className={inputCls}
                        value={method}
                        onChange={(e) =>
                          setMethod(e.target.value as "credit_card" | "check" | "cash" | "ach")
                        }
                      >
                        <option value="credit_card">Company card</option>
                        <option value="check">Check</option>
                        <option value="cash">Cash</option>
                        <option value="ach">Bank transfer</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Paid by</label>
                      <select
                        className={inputCls}
                        value={paidBy}
                        onChange={(e) => setPaidBy(e.target.value)}
                      >
                        <option value="">Me</option>
                        {payers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs text-muted-foreground">Due date</label>
                    <input
                      type="date"
                      className={inputCls}
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground">
                  {paid
                    ? "Books to the job's Spent and creates the QuickBooks expense on that person's card."
                    : "Sits in Unpaid until someone marks it paid — then it goes to QuickBooks."}
                </div>
              </div>

              {error && <div className="text-sm text-destructive">{error}</div>}

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={reset} disabled={busy !== false}>
                  Start over
                </Button>
                <Button size="sm" className="flex-1" onClick={file} disabled={!canFile || busy !== false}>
                  {busy === "filing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : paid ? (
                    "File it — paid"
                  ) : (
                    "File it — unpaid"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
