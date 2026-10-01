"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { v } from "@/components/field-feed/tokens";
import { compressImage } from "@/lib/image/compress";
import { saveReceiptUpload } from "@/lib/receipts/save-upload";
import { searchActiveJobs, type ClockInJob } from "@/lib/actions/daily-logs";
import { listMyUnfinishedReceipts, type UnfinishedReceipt } from "@/lib/actions/crew-receipts";
import type {
  AllocationStatus,
  CrewAllocateResponse,
  CrewAllocation,
  CrewBudgetLine,
  CrewDocumented,
  CrewFiled,
  CrewJobSource,
  CrewReadResponse,
} from "@/lib/crew/receipt-scan-types";
import {
  GhostButton,
  IconAlert,
  IconCamera,
  IconCheck,
  IconChevron,
  IconClock,
  IconPin,
  IconPlus,
  IconReceipt,
  IconX,
  Label,
  MoneyInput,
  Notice,
  PhotoViewer,
  PrimaryButton,
  SearchBox,
  SecondaryButton,
  Sheet,
  Spinner,
  Thumb,
  TONE,
  money,
  parseMoney,
  round2,
} from "./receipt-parts";

/**
 * "Scan a receipt" — the crew's front door to field invoice capture.
 *
 *   photo → saved → read (vendor, total, items, job) → split to budget lines → File
 *
 * The photo is saved before anything else, so nothing a bad signal does can
 * lose it; an unfinished scan waits on the card under "not filed yet". The
 * read and the budget-line split are separate requests: the receipt shows up
 * as soon as it is read, and changing the job only re-splits (seconds) rather
 * than re-reading the photo. Nothing touches the books until File.
 */

type View = "closed" | "reading" | "readError" | "review" | "pickJob" | "pickLine" | "done" | "unfinished";
type PayMethod = "credit_card" | "cash" | "check" | "on_account";
type Job = { id: string; label: string };

const PAY_OPTIONS: Array<[PayMethod, string]> = [
  ["credit_card", "Company card"],
  ["cash", "Cash"],
  ["check", "Check"],
  ["on_account", "House account"],
];

const DISMISSED_KEY = "crew-receipts-dismissed";

function loadDismissed(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}
function saveDismissed(paths: string[]) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(paths.slice(-200)));
  } catch {
    // Private browsing: the row just comes back next time.
  }
}

type CallResult<T> = { ok: true; data: T } | { ok: false; error: string; aborted?: boolean };

/** fetch that never throws and never chokes on a gateway's HTML error page. */
async function call<T>(url: string, init: RequestInit): Promise<CallResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, error: "", aborted: true };
    return { ok: false, error: "No connection. Move to better signal and try again." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // A timeout comes back as an HTML page, not JSON.
  }
  if (!res.ok || body === null) {
    const msg = (body as { error?: string } | null)?.error;
    return {
      ok: false,
      error: msg || (res.status === 504 || res.status === 408
        ? "That took too long. Try again."
        : `Something went wrong (${res.status}). Try again.`),
    };
  }
  return { ok: true, data: body as T };
}

function shortJob(label: string): string {
  return label.replace(/^PC-\d{4}-\d+\s+/, "");
}

function prettyDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function savedAgo(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
}

export function ReceiptCapture() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<View>("closed");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const localUrlRef = useRef<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const pendingBlobRef = useRef<Blob | null>(null);
  // Bumped on every new scan and every close: an upload or read that finishes
  // after the sheet was closed must not pop it back open.
  const sessionRef = useRef(0);

  // Reading
  const [step, setStep] = useState<"saving" | "reading">("saving");
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const readAbortRef = useRef<AbortController | null>(null);
  const [readError, setReadError] = useState<{ message: string; stage: "upload" | "read" } | null>(null);

  // The read and what the crew member did with it
  const [read, setRead] = useState<CrewReadResponse | null>(null);
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState("");
  const [total, setTotal] = useState<number | null>(null);
  const totalRef = useRef<number | null>(null);
  const [docType, setDocType] = useState("receipt");
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalDraft, setTotalDraft] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [payment, setPayment] = useState<PayMethod>("credit_card");

  // Job + budget lines
  const [job, setJob] = useState<Job | null>(null);
  const [jobSource, setJobSource] = useState<CrewJobSource | null>(null);
  const [jobReason, setJobReason] = useState<string | null>(null);
  const [alloc, setAlloc] = useState<{ status: AllocationStatus | "idle"; error?: string; retry?: boolean }>({ status: "idle" });
  const allocReq = useRef(0);
  const [allocations, setAllocations] = useState<CrewAllocation[]>([]);
  const [budgetLines, setBudgetLines] = useState<CrewBudgetLine[]>([]);
  const [linePick, setLinePick] = useState<{ mode: "move"; index: number } | { mode: "add" } | null>(null);
  const [lineQuery, setLineQuery] = useState("");

  // Job picker
  const [jobQuery, setJobQuery] = useState("");
  const [jobs, setJobs] = useState<ClockInJob[]>([]);
  const [jobsState, setJobsState] = useState<"loading" | "ready" | "error">("loading");
  const [jobsRetry, setJobsRetry] = useState(0);

  // Filing
  const filingRef = useRef(false);
  const [filing, setFiling] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<CrewFiled | CrewDocumented | null>(null);

  // Saved but never filed
  const [unfinished, setUnfinished] = useState<UnfinishedReceipt[]>([]);
  const [unfinishedState, setUnfinishedState] = useState<"idle" | "loading" | "error">("idle");

  const refreshUnfinished = useCallback(async (withPhotos = false) => {
    if (withPhotos) setUnfinishedState("loading");
    try {
      const dismissed = new Set(loadDismissed());
      const rows = await listMyUnfinishedReceipts({ withPhotos });
      setUnfinished(rows.filter((r) => !dismissed.has(r.storagePath)));
      setUnfinishedState("idle");
    } catch {
      if (withPhotos) setUnfinishedState("error");
    }
  }, []);

  useEffect(() => {
    void refreshUnfinished(false);
  }, [refreshUnfinished]);

  useEffect(() => {
    totalRef.current = total;
  }, [total]);

  // Elapsed clock while reading — a silent spinner is what made people quit.
  useEffect(() => {
    if (view !== "reading") return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [view, startedAt]);

  // Debounced job search for the picker.
  useEffect(() => {
    if (view !== "pickJob") return;
    let cancelled = false;
    const t = setTimeout(() => {
      searchActiveJobs(jobQuery)
        .then((rows) => {
          if (cancelled) return;
          setJobs(rows);
          setJobsState("ready");
        })
        .catch(() => {
          if (!cancelled) setJobsState("error");
        });
    }, jobQuery ? 220 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [view, jobQuery, jobsRetry]);

  useEffect(() => () => {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
  }, []);

  /* ---------------------------------------------------------------- flow */

  function setLocalPhoto(url: string | null) {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    localUrlRef.current = url && url.startsWith("blob:") ? url : null;
    setPhotoUrl(url);
  }

  function resetScan() {
    sessionRef.current++;
    readAbortRef.current?.abort();
    readAbortRef.current = null;
    allocReq.current++;
    pendingBlobRef.current = null;
    setStoragePath(null);
    setReadError(null);
    setRead(null);
    setVendor("");
    setDate("");
    setTotal(null);
    setDocType("receipt");
    setEditingTotal(false);
    setEditingDetails(false);
    setShowItems(false);
    setPayment("credit_card");
    setJob(null);
    setJobSource(null);
    setJobReason(null);
    setAlloc({ status: "idle" });
    setAllocations([]);
    setBudgetLines([]);
    setLinePick(null);
    setLineQuery("");
    setJobQuery("");
    setFileError(null);
    setResult(null);
    setViewerOpen(false);
    setLocalPhoto(null);
  }

  function close() {
    resetScan();
    setView("closed");
    if (inputRef.current) inputRef.current.value = "";
    void refreshUnfinished(false);
  }

  /** Opens the phone's camera / library. Must run inside the tap itself — iOS
   * ignores a file-picker click fired from a timer (why "Retake" did nothing). */
  function pickPhoto() {
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  }

  function retake() {
    close();
    pickPhoto();
  }

  async function onFile(file: File) {
    resetScan();
    const session = sessionRef.current;
    setLocalPhoto(URL.createObjectURL(file));
    setStartedAt(Date.now());
    setElapsed(0);
    setStep("saving");
    setView("reading");
    // Always hand over a JPEG: an iPhone HEIC can't be read, and a full-size
    // photo stalls the upload on jobsite signal.
    let blob: Blob = file;
    try {
      blob = await compressImage(file);
    } catch {
      // Undecodable here — send the original and let the server explain.
    }
    if (session !== sessionRef.current) return;
    pendingBlobRef.current = blob;
    await uploadAndRead(blob, session);
  }

  async function uploadAndRead(blob: Blob, session = sessionRef.current) {
    setReadError(null);
    setStep("saving");
    setView("reading");
    const body = new FormData();
    body.append("file", new File([blob], "receipt.jpg", { type: blob.type || "image/jpeg" }));
    let path: string | null = null;
    try {
      path = await saveReceiptUpload(body);
    } catch {
      // The upload itself may have landed even if the check after it didn't.
      path = (body.get("storagePath") as string | null) || null;
    }
    if (session !== sessionRef.current) return;
    if (!path) {
      setReadError({ stage: "upload", message: "The photo didn't upload. Check your signal and try again." });
      setView("readError");
      return;
    }
    pendingBlobRef.current = null;
    setStoragePath(path);
    await readSaved(path, session);
  }

  async function readSaved(path: string, session = sessionRef.current) {
    setReadError(null);
    setStep("reading");
    setView("reading");
    readAbortRef.current?.abort();
    const ctrl = new AbortController();
    readAbortRef.current = ctrl;
    const fd = new FormData();
    fd.append("storagePath", path);
    const res = await call<CrewReadResponse>("/api/crew/field-capture", { method: "POST", body: fd, signal: ctrl.signal });
    if (session !== sessionRef.current || ctrl.signal.aborted || (!res.ok && res.aborted)) return;
    if (!res.ok) {
      setReadError({ stage: "read", message: res.error });
      setView("readError");
      return;
    }
    applyRead(res.data);
  }

  function applyRead(r: CrewReadResponse) {
    setRead(r);
    setVendor(r.scan.vendor);
    setDate(r.scan.date ?? "");
    setTotal(r.scan.amount);
    totalRef.current = r.scan.amount;
    setDocType(r.scan.documentType);
    // A house-account ticket was signed for, not paid — it files unpaid.
    setPayment(r.scan.chargedToAccount ? "on_account" : "credit_card");
    setJob(r.job);
    setJobSource(r.jobSource);
    setJobReason(r.jobReason);
    setAllocations([]);
    setBudgetLines([]);
    if (!r.job) {
      setAlloc({ status: "idle" });
      setJobQuery("");
      setJobsState("loading");
      setView("pickJob");
      return;
    }
    setView("review");
    if (r.allocationStatus === "pending") void allocate(r.job.id, r.scan.storagePath, r.scan.amount);
    else setAlloc({ status: "not_required" });
  }

  async function allocate(projectId: string, path: string | null = storagePath, amount: number | null = totalRef.current) {
    if (!path) return;
    const id = ++allocReq.current;
    setAlloc({ status: "pending" });
    setAllocations([]);
    const res = await call<CrewAllocateResponse>("/api/crew/field-capture/allocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath: path, projectId, amount }),
    });
    if (id !== allocReq.current) return;
    if (!res.ok) {
      setAlloc({ status: "failed", error: res.error, retry: true });
      return;
    }
    setBudgetLines(res.data.budgetLines);
    setJob(res.data.job);
    let next = res.data.allocations;
    // The total may have been corrected while the split was running.
    const current = totalRef.current;
    if (next.length === 1 && current !== null && Math.abs(next[0].amount - current) > 0.009) {
      next = [{ ...next[0], amount: current }];
    }
    setAllocations(next);
    setAlloc({ status: res.data.allocationStatus, error: res.data.allocationError });
  }

  function needsAllocation(type = docType, amount = total) {
    return amount !== null && !["quote", "delivery_ticket"].includes(type);
  }

  function chooseJob(next: Job) {
    setJob(next);
    setJobSource("picked");
    setJobReason(null);
    setView("review");
    if (needsAllocation()) void allocate(next.id);
    else {
      allocReq.current++;
      setAllocations([]);
      setAlloc({ status: "not_required" });
    }
  }

  function openJobPicker() {
    setJobQuery("");
    setJobsState("loading");
    setView("pickJob");
  }

  function commitTotal() {
    setEditingTotal(false);
    const n = parseMoney(totalDraft);
    if (n === null || n === 0) return;
    const signed = read?.scan.isCredit ? -Math.abs(n) : Math.abs(n);
    if (total !== null && Math.abs(signed - total) < 0.005) return;
    setTotal(signed);
    totalRef.current = signed;
    setAllocations((prev) => (prev.length === 1 ? [{ ...prev[0], amount: signed }] : prev));
    // A delivery ticket with a total typed onto it is a receipt after all.
    if (docType === "delivery_ticket" || total === null) {
      const type = docType === "delivery_ticket" ? "receipt" : docType;
      setDocType(type);
      if (job && needsAllocation(type, signed)) void allocate(job.id, storagePath, signed);
    }
  }

  function applyLinePick(line: CrewBudgetLine) {
    if (!linePick) return;
    if (linePick.mode === "move") {
      const idx = linePick.index;
      setAllocations((prev) =>
        prev.map((a, i) => (i === idx ? { ...a, lineItemId: line.id, lineLabel: line.description, trade: line.trade, note: null } : a)),
      );
    } else {
      setAllocations((prev) => {
        const placed = round2(prev.reduce((s, a) => s + a.amount, 0));
        const rest = round2((total ?? 0) - placed);
        return [
          ...prev,
          {
            lineItemId: line.id,
            lineLabel: line.description,
            trade: line.trade,
            // First line takes the whole receipt; a later one takes whatever is
            // still unplaced (0 when the split already adds up — type it in).
            amount: prev.length === 0 ? (total ?? 0) : Math.abs(rest) > 0.009 ? rest : 0,
            note: null,
          },
        ];
      });
    }
    setLinePick(null);
    setLineQuery("");
    setView("review");
  }

  async function file() {
    if (filingRef.current || !job || !storagePath || !read) return;
    filingRef.current = true;
    setFiling(true);
    setFileError(null);
    const s = read.scan;
    const res = await call<CrewFiled | CrewDocumented>("/api/crew/field-capture/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storagePath,
        projectId: job.id,
        documentType: docType,
        filename: s.filename,
        vendor: vendor.trim() || s.vendor,
        amount: total,
        invoiceNumber: s.invoiceNumber,
        date: date || s.date,
        trade: s.trade,
        summary: s.summary,
        extractedText: s.extractedText,
        lowConfidence: s.lowConfidence,
        paymentMethod: payment,
        allocations: allocations.map((a) => ({ lineItemId: a.lineItemId, amount: a.amount, note: a.note })),
      }),
    });
    filingRef.current = false;
    setFiling(false);
    if (!res.ok) {
      setFileError(`Not filed — ${res.error.replace(/\.$/, "")}. Your receipt is saved; tap File to try again.`);
      return;
    }
    setResult(res.data);
    setView("done");
    router.refresh();
    void refreshUnfinished(false);
  }

  function openUnfinished() {
    resetScan();
    setView("unfinished");
    void refreshUnfinished(true);
  }

  function finishUnfinished(row: UnfinishedReceipt) {
    resetScan();
    const session = sessionRef.current;
    setLocalPhoto(row.photoUrl);
    setStoragePath(row.storagePath);
    setStartedAt(Date.now());
    setElapsed(0);
    void readSaved(row.storagePath, session);
  }

  function dismissUnfinished(row: UnfinishedReceipt) {
    saveDismissed([...loadDismissed(), row.storagePath]);
    setUnfinished((prev) => prev.filter((r) => r.storagePath !== row.storagePath));
  }

  /* ------------------------------------------------------------ derived */

  const isCredit = Boolean(read?.scan.isCredit);
  const isQuote = docType === "quote";
  const isTicket = docType === "delivery_ticket" || total === null;
  const hasMoney = !isQuote && !isTicket;
  const assigned = round2(allocations.reduce((s, a) => s + a.amount, 0));
  const remaining = round2((total ?? 0) - assigned);
  const balanced = allocations.length === 0 || Math.abs(remaining) < 0.011;
  const canFile =
    Boolean(job && storagePath && read) &&
    !filing &&
    (!hasMoney || (alloc.status !== "pending" && balanced));

  const usedLineIds = useMemo(() => new Set(allocations.map((a) => a.lineItemId)), [allocations]);
  const pickableLines = useMemo(() => {
    const term = lineQuery.trim().toLowerCase();
    return budgetLines.filter((l) => {
      const own = linePick?.mode === "move" && allocations[linePick.index]?.lineItemId === l.id;
      if (!own && usedLineIds.has(l.id)) return false;
      if (!term) return true;
      return `${l.description} ${l.trade ?? ""} ${l.section ?? ""}`.toLowerCase().includes(term);
    });
  }, [budgetLines, lineQuery, linePick, allocations, usedLineIds]);

  const suggestedJobs = (read?.suggestedJobs ?? []).filter((j) => j.id !== job?.id);

  /* ------------------------------------------------------------- render */

  const fileLabel = isQuote
    ? "File as a quote"
    : isTicket
      ? "File the delivery ticket"
      : isCredit
        ? `File the ${money(Math.abs(total ?? 0))} credit`
        : `File ${money(total)}`;

  return (
    <>
      {/* No `capture` attribute — the phone then offers the photo library as
          well as the camera, so a receipt already in the camera roll works. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />

      {/* ---------- The card on /crew ---------- */}
      <div className="rounded-2xl overflow-hidden" style={{ background: v("card"), border: `1px solid ${v("line")}` }}>
        <button
          type="button"
          onClick={pickPhoto}
          className="w-full flex items-center gap-3 px-3.5 py-3.5 text-left transition active:bg-white/[0.03]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(217,119,6,0.14)" }}>
            <IconReceipt className="w-[18px] h-[18px]" style={{ color: v("accent") }} />
          </span>
          <span className="flex flex-col min-w-0 flex-1">
            <span className="text-[14px] font-medium" style={{ color: v("ink") }}>Scan a receipt</span>
            <span className="text-[11px] truncate" style={{ color: v("quiet") }}>
              Snap it — it reads it and files it to the job
            </span>
          </span>
          <IconCamera className="w-5 h-5 shrink-0" style={{ color: v("muted") }} />
        </button>
        {unfinished.length > 0 && (
          <button
            type="button"
            onClick={openUnfinished}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition active:bg-white/[0.03]"
            style={{ borderTop: `1px solid ${v("line")}`, background: "rgba(217,119,6,0.06)" }}
          >
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: v("accent") }} />
            <span className="flex-1 text-[12.5px] font-medium" style={{ color: TONE.warn.fg }}>
              {unfinished.length === 1 ? "1 receipt saved but not filed" : `${unfinished.length} receipts saved but not filed`}
            </span>
            <span className="text-[12px] font-semibold" style={{ color: v("accent") }}>Finish</span>
            <IconChevron className="w-4 h-4" style={{ color: v("accent") }} />
          </button>
        )}
      </div>

      {viewerOpen && photoUrl && <PhotoViewer src={photoUrl} onClose={() => setViewerOpen(false)} />}

      {/* ---------- Reading ---------- */}
      {view === "reading" && (
        <Sheet
          title="Reading your receipt"
          onClose={close}
          locked
          footer={
            step === "reading" ? (
              <GhostButton onClick={close}>Finish later — the photo is saved</GhostButton>
            ) : (
              <GhostButton onClick={close}>Cancel</GhostButton>
            )
          }
        >
          <style>{`@keyframes rc-scan{0%{top:6%}50%{top:90%}100%{top:6%}}`}</style>
          <div className="flex flex-col items-center gap-5 pt-2">
            <div
              className="relative overflow-hidden rounded-2xl"
              style={{ width: 168, height: 220, background: v("bg-2"), border: `1px solid ${v("line")}` }}
            >
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL
                <img src={photoUrl} alt="" className="w-full h-full object-cover" style={{ opacity: 0.85 }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ color: v("quiet") }}>
                  <IconReceipt className="w-10 h-10" />
                </div>
              )}
              <span
                className="absolute left-0 right-0 h-[2px]"
                style={{
                  background: v("accent"),
                  boxShadow: "0 0 14px 3px rgba(217,119,6,0.55)",
                  animation: "rc-scan 2.4s ease-in-out infinite",
                }}
              />
            </div>
            <div className="w-full flex flex-col gap-2.5">
              {[
                { key: "saving", label: "Saving the photo" },
                { key: "reading", label: "Reading the store, total and items" },
                { key: "job", label: "Finding the job" },
              ].map((s, i) => {
                const order = step === "saving" ? 0 : 1;
                const state = i < order ? "done" : i === order ? "active" : "todo";
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    {state === "done" ? (
                      <span className="h-5 w-5 rounded-full flex items-center justify-center" style={{ background: TONE.ok.bg, color: TONE.ok.fg }}>
                        <IconCheck className="w-3.5 h-3.5" />
                      </span>
                    ) : state === "active" ? (
                      <span className="h-5 w-5 flex items-center justify-center"><Spinner size={16} /></span>
                    ) : (
                      <span className="h-5 w-5 flex items-center justify-center">
                        <span className="h-2 w-2 rounded-full" style={{ background: v("quiet"), opacity: 0.5 }} />
                      </span>
                    )}
                    <span className="text-[14px]" style={{ color: state === "todo" ? v("quiet") : v("ink") }}>{s.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="w-full text-[12px] text-center tabular-nums" style={{ color: v("quiet") }}>
              {elapsed < 40
                ? `${elapsed}s · usually about 20 seconds`
                : `${elapsed}s · taking longer than usual. Keep it open, or finish later — it's saved.`}
            </div>
          </div>
        </Sheet>
      )}

      {/* ---------- Couldn't read / upload ---------- */}
      {view === "readError" && readError && (
        <Sheet
          title={readError.stage === "upload" ? "Photo didn't upload" : "Couldn't read it"}
          onClose={close}
          footer={
            <div className="flex flex-col gap-2">
              <PrimaryButton
                onClick={() => {
                  setStartedAt(Date.now());
                  setElapsed(0);
                  if (readError.stage === "upload" && pendingBlobRef.current) void uploadAndRead(pendingBlobRef.current);
                  else if (storagePath) void readSaved(storagePath);
                }}
              >
                Try again
              </PrimaryButton>
              <SecondaryButton onClick={retake}>Take a new photo</SecondaryButton>
            </div>
          }
        >
          <div className="flex flex-col items-center text-center gap-3 pt-3">
            <span className="h-12 w-12 rounded-full flex items-center justify-center" style={{ background: TONE.error.bg, color: TONE.error.fg }}>
              <IconAlert className="w-6 h-6" />
            </span>
            <div className="text-[14px] leading-snug" style={{ color: v("ink") }}>{readError.message}</div>
            <div className="text-[12.5px]" style={{ color: v("quiet") }}>
              {readError.stage === "read"
                ? "The photo is saved and nothing was filed. You can also close this and finish it later from the card."
                : "Nothing was saved or filed yet."}
            </div>
          </div>
        </Sheet>
      )}

      {/* ---------- Which job ---------- */}
      {view === "pickJob" && read && (
        <Sheet
          title="Which job is this for?"
          onClose={close}
          onBack={job ? () => setView("review") : undefined}
        >
          <div className="flex items-center gap-3 rounded-2xl p-2.5 mb-4" style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}>
            <Thumb src={photoUrl} size={40} onOpen={() => setViewerOpen(true)} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold truncate">{vendor || read.scan.vendor}</div>
              <div className="text-[12px] tabular-nums" style={{ color: v("muted") }}>
                {[money(total), prettyDate(date)].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
          {!job && (
            <div className="text-[12.5px] mb-3 px-0.5" style={{ color: v("muted") }}>
              {read.scan.jobHint
                ? `It reads "${read.scan.jobHint}" — pick the job that is.`
                : "No job name on the receipt — pick the job you bought it for."}
            </div>
          )}

          {suggestedJobs.length > 0 && !jobQuery && (
            <div className="mb-4">
              <Label>From your time card</Label>
              <div className="flex flex-col gap-1.5">
                {suggestedJobs.map((j) => (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => chooseJob({ id: j.id, label: j.label })}
                    className="w-full flex items-center gap-3 text-left rounded-2xl px-3.5 py-3 transition active:scale-[0.99]"
                    style={{ background: "rgba(217,119,6,0.07)", border: "1px solid rgba(217,119,6,0.28)" }}
                  >
                    <IconClock className="w-[18px] h-[18px] shrink-0" style={{ color: v("accent") }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium truncate">{shortJob(j.label)}</span>
                      <span className="block text-[11.5px] truncate" style={{ color: v("muted") }}>{j.reason}</span>
                    </span>
                    <IconChevron className="w-4 h-4 shrink-0" style={{ color: v("quiet") }} />
                  </button>
                ))}
              </div>
            </div>
          )}

          <Label>All jobs</Label>
          <SearchBox value={jobQuery} onChange={setJobQuery} placeholder="Search by name, street or PC #" />
          <div className="flex flex-col gap-1.5 mt-2">
            {jobsState === "loading" && jobs.length === 0 &&
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[54px] rounded-2xl animate-pulse" style={{ background: v("bg-2") }} />
              ))}
            {jobsState === "error" && (
              <Notice tone="error">
                Jobs didn&apos;t load.{" "}
                <button type="button" className="underline font-semibold" onClick={() => { setJobsState("loading"); setJobsRetry((n) => n + 1); }}>
                  Try again
                </button>
              </Notice>
            )}
            {jobsState === "ready" && jobs.length === 0 && (
              <div className="text-[13px] py-3 px-1" style={{ color: v("quiet") }}>
                {jobQuery ? `No active job matches “${jobQuery}”.` : "No active jobs to show."}
              </div>
            )}
            {jobs.map((j) => {
              const current = j.id === job?.id;
              return (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => chooseJob({ id: j.id, label: j.project_number ? `${j.project_number} ${j.name}` : j.name })}
                  className="w-full flex items-center gap-3 text-left rounded-2xl px-3.5 py-3 transition active:scale-[0.99]"
                  style={{ background: v("bg-2"), border: `1px solid ${current ? v("accent") : v("line")}` }}
                >
                  <IconPin className="w-[18px] h-[18px] shrink-0" style={{ color: v("quiet") }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium truncate">{j.name}</span>
                    <span className="block text-[11.5px] truncate" style={{ color: v("quiet") }}>
                      {[j.project_number, j.address, j.city].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {current && <IconCheck className="w-4 h-4 shrink-0" style={{ color: v("accent") }} />}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}

      {/* ---------- Pick a budget line ---------- */}
      {view === "pickLine" && linePick && (
        <Sheet
          title={linePick.mode === "move" ? "Charge it to…" : "Split to another line"}
          onClose={close}
          onBack={() => {
            setLinePick(null);
            setLineQuery("");
            setView("review");
          }}
        >
          <SearchBox value={lineQuery} onChange={setLineQuery} placeholder="Search budget lines" />
          <div className="flex flex-col gap-1.5 mt-3">
            {pickableLines.length === 0 && (
              <div className="text-[13px] py-3 px-1" style={{ color: v("quiet") }}>No budget lines match that.</div>
            )}
            {pickableLines.map((l, i) => {
              const groupStart = i === 0 || pickableLines[i - 1].isChangeOrder !== l.isChangeOrder;
              return (
                <div key={l.id}>
                  {groupStart && (
                    <div className={i === 0 ? "" : "mt-3"}>
                      <Label>{l.isChangeOrder ? "Change orders" : "Contract"}</Label>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => applyLinePick(l)}
                    className="w-full text-left rounded-2xl px-3.5 py-3 transition active:scale-[0.99]"
                    style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                  >
                    <div className="text-[14px] font-medium leading-snug">{l.description}</div>
                    {(l.section || l.trade) && (
                      <div className="text-[11.5px] mt-0.5 truncate" style={{ color: v("quiet") }}>
                        {l.section && l.trade && l.section.toLowerCase() === l.trade.toLowerCase()
                          ? l.section
                          : [l.section, l.trade].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </Sheet>
      )}

      {/* ---------- Review ---------- */}
      {view === "review" && read && job && (
        <Sheet
          title={isQuote ? "Quote" : isCredit ? "Return credit" : isTicket ? "Delivery ticket" : "Check it, then file"}
          onClose={close}
          locked={filing}
          footer={
            <div className="flex flex-col gap-1.5">
              {fileError && <div className="mb-1.5"><Notice tone="error">{fileError}</Notice></div>}
              <PrimaryButton onClick={file} disabled={!canFile} busy={filing}>
                <span className="flex flex-col items-center leading-tight">
                  <span>{filing ? "Filing…" : alloc.status === "pending" && hasMoney ? "Matching budget lines…" : fileLabel}</span>
                  {!filing && <span className="text-[11px] font-medium opacity-75 truncate max-w-[260px]">to {shortJob(job.label)}</span>}
                </span>
              </PrimaryButton>
              <GhostButton onClick={retake}>Retake the photo</GhostButton>
            </div>
          }
        >
          <div className="flex flex-col gap-5">
            {/* Header: photo + who + when */}
            <div className="flex items-start gap-3">
              <Thumb src={photoUrl} onOpen={() => setViewerOpen(true)} />
              <div className="min-w-0 flex-1 pt-0.5">
                {editingDetails ? (
                  <div className="flex flex-col gap-2">
                    <input
                      value={vendor}
                      onChange={(e) => setVendor(e.target.value)}
                      aria-label="Store or vendor"
                      className="w-full rounded-xl px-3 h-10 text-[14px] outline-none"
                      style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("ink") }}
                    />
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      aria-label="Receipt date"
                      className="w-full rounded-xl px-3 h-10 text-[14px] outline-none"
                      style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("ink"), colorScheme: "dark" }}
                    />
                    <button type="button" onClick={() => setEditingDetails(false)} className="self-start text-[12.5px] font-semibold" style={{ color: v("accent") }}>
                      Done
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="text-[16px] font-semibold leading-snug break-words">{vendor || "Unknown store"}</div>
                    <div className="text-[12px] mt-0.5" style={{ color: v("quiet") }}>
                      {[prettyDate(date) ?? "No date on it", read.scan.invoiceNumber && `#${read.scan.invoiceNumber}`].filter(Boolean).join(" · ")}
                    </div>
                    <button type="button" onClick={() => setEditingDetails(true)} className="text-[12px] font-semibold mt-1" style={{ color: v("accent") }}>
                      Fix store or date
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Total */}
            {!isQuote && (
              <div className="rounded-2xl px-4 py-3.5" style={{ background: v("bg-2"), border: `1px solid ${read.scan.lowConfidence ? TONE.warn.line : v("line")}` }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-semibold uppercase" style={{ color: v("quiet"), letterSpacing: "0.14em" }}>
                    {isCredit ? "Credit back" : "Total paid"}
                  </span>
                  {!editingTotal && (
                    <button
                      type="button"
                      onClick={() => {
                        setTotalDraft(total === null ? "" : Math.abs(total).toFixed(2));
                        setEditingTotal(true);
                      }}
                      className="text-[12px] font-semibold"
                      style={{ color: v("accent") }}
                    >
                      {total === null ? "Add the total" : "Fix the total"}
                    </button>
                  )}
                </div>
                {editingTotal ? (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[26px] font-semibold" style={{ color: v("quiet") }}>$</span>
                    <input
                      autoFocus
                      value={totalDraft}
                      inputMode="decimal"
                      enterKeyHint="done"
                      aria-label="Receipt total"
                      onChange={(e) => setTotalDraft(e.target.value.replace(/[^0-9.,]/g, ""))}
                      onBlur={commitTotal}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      className="flex-1 min-w-0 bg-transparent text-[32px] font-semibold tracking-tight tabular-nums outline-none"
                      style={{ color: v("ink"), borderBottom: `2px solid ${v("accent")}` }}
                    />
                  </div>
                ) : (
                  <div className="text-[34px] font-semibold tracking-tight leading-none mt-1.5 tabular-nums" style={{ color: isCredit ? TONE.ok.fg : v("ink") }}>
                    {total === null ? <span style={{ color: v("quiet") }}>No total</span> : money(total)}
                  </div>
                )}
                {read.scan.lowConfidence && !editingTotal && (
                  <div className="flex items-center gap-1.5 mt-2 text-[12px]" style={{ color: TONE.warn.fg }}>
                    <IconAlert className="w-3.5 h-3.5 shrink-0" />
                    Hard to read — check it against the photo.
                  </div>
                )}
              </div>
            )}

            {isQuote && (
              <Notice tone="warn">
                This reads as a <b>quote</b>{read.scan.quoteReason ? ` (${read.scan.quoteReason})` : ""} — a price offered, not money spent. It files with the job&apos;s quotes for the office.
              </Notice>
            )}
            {isCredit && (
              <Notice tone="ok">
                This is a <b>return credit</b>{read.scan.creditReason ? ` (${read.scan.creditReason})` : ""}. It takes money back off the budget line.
              </Notice>
            )}
            {isTicket && !isQuote && (
              <Notice tone="info">
                No dollar total on it, so it files with the job&apos;s paperwork, not the budget. If it does have a total, tap <b>Add the total</b>.
              </Notice>
            )}

            {/* Job */}
            <div>
              <Label>Job</Label>
              <button
                type="button"
                onClick={openJobPicker}
                className="w-full flex items-center gap-3 text-left rounded-2xl px-3.5 py-3 transition active:scale-[0.99]"
                style={{ background: v("bg-2"), border: `1px solid ${jobSource === "picked" ? v("line") : "rgba(217,119,6,0.28)"}` }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-medium truncate">{shortJob(job.label)}</span>
                  <span className="flex items-start gap-1.5 text-[11.5px] mt-0.5 leading-snug" style={{ color: v("muted") }}>
                    {jobSource === "timecard" && <IconClock className="w-3.5 h-3.5 shrink-0 mt-px" />}
                    <span className="min-w-0">
                      {jobReason ?? (job.label.match(/^PC-\d{4}-\d+/)?.[0] || "")}
                    </span>
                  </span>
                </span>
                <span className="text-[12.5px] font-semibold shrink-0" style={{ color: v("accent") }}>Change</span>
              </button>
            </div>

            {/* Budget lines */}
            {hasMoney && (
              <div>
                <Label
                  right={
                    allocations.length > 0 ? (
                      <span className="text-[11.5px] font-medium tabular-nums" style={{ color: balanced ? TONE.ok.fg : TONE.warn.fg }}>
                        {balanced ? "All placed" : `${money(Math.abs(assigned))} of ${money(Math.abs(total ?? 0))}`}
                      </span>
                    ) : undefined
                  }
                >
                  Budget line
                </Label>

                {alloc.status === "pending" && (
                  <div className="flex items-center gap-3 rounded-2xl px-3.5 py-3.5" style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}>
                    <Spinner size={15} />
                    <span className="text-[13px]" style={{ color: v("muted") }}>Matching it to the job&apos;s budget…</span>
                  </div>
                )}

                {alloc.status !== "pending" && (
                  <div className="flex flex-col gap-1.5">
                    {allocations.length === 0 && (
                      <Notice tone={alloc.status === "failed" ? "warn" : "info"}>
                        <span>{alloc.error ?? "No budget line picked yet."}</span>
                        {alloc.retry && job && (
                          <>
                            {" "}
                            <button type="button" className="underline font-semibold" onClick={() => void allocate(job.id)}>
                              Retry
                            </button>
                          </>
                        )}
                        {budgetLines.length > 0 && (
                          <span className="block mt-1" style={{ color: v("muted") }}>
                            You can still file it — the office will place it.
                          </span>
                        )}
                      </Notice>
                    )}

                    {allocations.map((a, i) => (
                      <div
                        key={`${a.lineItemId}-${i}`}
                        className="flex items-center gap-2 rounded-2xl pl-3.5 pr-2 py-2.5"
                        style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setLinePick({ mode: "move", index: i });
                            setLineQuery("");
                            setView("pickLine");
                          }}
                          disabled={budgetLines.length === 0}
                          className="min-w-0 flex-1 text-left py-0.5"
                        >
                          <span className="block text-[14px] font-medium leading-snug">{a.lineLabel}</span>
                          <span className="flex items-center gap-1 text-[11.5px] mt-0.5 min-w-0" style={{ color: v("quiet") }}>
                            {a.note && <span className="truncate">{a.note} ·</span>}
                            <span className="shrink-0" style={{ color: v("accent") }}>Change</span>
                          </span>
                        </button>
                        {allocations.length > 1 ? (
                          <>
                            <MoneyInput
                              value={Math.abs(a.amount)}
                              ariaLabel={`Amount on ${a.lineLabel}`}
                              className="w-[104px] shrink-0"
                              onChange={(n) =>
                                setAllocations((prev) => {
                                  const signed = isCredit ? -Math.abs(n) : Math.abs(n);
                                  const next = prev.map((p, pi) => (pi === i ? { ...p, amount: signed } : p));
                                  // Two lines: the other one takes the rest, so a
                                  // split is one number typed, not two.
                                  if (next.length === 2 && total !== null) {
                                    const rest = round2(total - signed);
                                    if (rest === 0 || Math.sign(rest) === Math.sign(total)) {
                                      next[1 - i] = { ...next[1 - i], amount: rest };
                                    }
                                  }
                                  return next;
                                })
                              }
                            />
                            <button
                              type="button"
                              aria-label={`Remove ${a.lineLabel}`}
                              onClick={() => setAllocations((prev) => prev.filter((_, pi) => pi !== i))}
                              className="h-9 w-8 flex items-center justify-center rounded-lg shrink-0 active:bg-white/5"
                              style={{ color: v("quiet") }}
                            >
                              <IconX className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <span className="text-[14px] font-medium tabular-nums pr-1.5 shrink-0" style={{ color: v("muted") }}>
                            {money(a.amount)}
                          </span>
                        )}
                      </div>
                    ))}

                    {!balanced && allocations.length > 0 && (
                      <Notice tone="warn">
                        {money(Math.abs(remaining))} {(remaining > 0) !== isCredit ? "still to place" : "too much placed"}.{" "}
                        <button
                          type="button"
                          className="underline font-semibold"
                          onClick={() =>
                            setAllocations((prev) => {
                              const big = prev.reduce((b, x, k) => (Math.abs(x.amount) > Math.abs(prev[b].amount) ? k : b), 0);
                              return prev.map((x, k) => (k === big ? { ...x, amount: round2(x.amount + remaining) } : x));
                            })
                          }
                        >
                          Fix it on {allocations.reduce((b, x) => (Math.abs(x.amount) > Math.abs(b.amount) ? x : b)).lineLabel}
                        </button>
                      </Notice>
                    )}

                    {budgetLines.length > 0 && pickableLines.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setLinePick({ mode: "add" });
                          setLineQuery("");
                          setView("pickLine");
                        }}
                        className="w-full flex items-center justify-center gap-1.5 rounded-2xl px-3 py-3 text-[13px] font-semibold"
                        style={{ border: `1px dashed rgba(217,119,6,0.45)`, color: v("accent") }}
                      >
                        <IconPlus className="w-4 h-4" />
                        {allocations.length === 0 ? "Pick a budget line" : "Split across another line"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Paid with */}
            {hasMoney && !isCredit && (
              <div>
                <Label>Paid with</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {PAY_OPTIONS.map(([value, label]) => {
                    const on = payment === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPayment(value)}
                        aria-pressed={on}
                        className="h-11 rounded-xl text-[13px] font-medium transition"
                        style={
                          on
                            ? { background: "rgba(217,119,6,0.16)", border: `1px solid ${v("accent")}`, color: v("ink") }
                            : { background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("muted") }
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {payment === "on_account" && (
                  <div className="text-[11.5px] mt-1.5 px-0.5" style={{ color: v("quiet") }}>
                    Signed for on the store account — the office pays it when the bill comes.
                  </div>
                )}
              </div>
            )}

            {/* What it read */}
            {read.scan.items.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowItems((s) => !s)} className="w-full flex items-center justify-between py-1">
                  <span className="text-[10.5px] font-semibold uppercase" style={{ color: v("quiet"), letterSpacing: "0.14em" }}>
                    On the receipt · {read.scan.items.length} {read.scan.items.length === 1 ? "item" : "items"}
                  </span>
                  <IconChevron className="w-4 h-4 transition-transform" style={{ color: v("quiet"), transform: showItems ? "rotate(90deg)" : undefined }} />
                </button>
                {showItems && (
                  <div className="flex flex-col mt-1.5 rounded-2xl overflow-hidden" style={{ border: `1px solid ${v("line")}` }}>
                    {read.scan.items.map((item, i) => (
                      <div
                        key={i}
                        className="flex items-start justify-between gap-3 px-3.5 py-2.5"
                        style={{ background: v("bg-2"), borderTop: i ? `1px solid ${v("line")}` : undefined }}
                      >
                        <span className="text-[12.5px] min-w-0 flex-1 leading-snug">
                          {item.description}
                          {item.trade && <span style={{ color: v("quiet") }}> · {item.trade}</span>}
                        </span>
                        <span className="text-[12.5px] shrink-0 tabular-nums" style={{ color: v("muted") }}>
                          {item.amount === null ? "—" : money(item.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Sheet>
      )}

      {/* ---------- Filed ---------- */}
      {view === "done" && result && (
        <Sheet
          title={result.alreadyFiled ? "Already filed" : "Filed"}
          onClose={close}
          footer={
            <div className="flex flex-col gap-2">
              <PrimaryButton onClick={retake}>
                <IconCamera className="w-[18px] h-[18px]" /> Scan another receipt
              </PrimaryButton>
              <SecondaryButton onClick={close}>Done</SecondaryButton>
            </div>
          }
        >
          <div className="flex flex-col items-center text-center gap-2 pt-4">
            <span className="h-16 w-16 rounded-full flex items-center justify-center mb-2" style={{ background: TONE.ok.bg, color: TONE.ok.fg, border: `1px solid ${TONE.ok.line}` }}>
              <IconCheck className="w-8 h-8" />
            </span>
            {result.status === "filed" ? (
              <>
                <div className="text-[30px] font-semibold tracking-tight tabular-nums">{money(result.amount)}</div>
                <div className="text-[14px]" style={{ color: v("muted") }}>{result.vendor}</div>
                <div className="text-[13px] mt-1 px-4 py-1.5 rounded-full" style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}>
                  {shortJob(result.project)}
                  {result.splitCount > 1 ? ` · ${result.splitCount} budget lines` : ""}
                </div>
              </>
            ) : (
              <>
                <div className="text-[18px] font-semibold">{result.kind === "quote" ? "Quote saved — not billed" : "Delivery ticket saved"}</div>
                <div className="text-[14px]" style={{ color: v("muted") }}>{result.vendor} · {shortJob(result.project)}</div>
              </>
            )}
            <div className="w-full mt-4 text-left">
              {result.alreadyFiled ? (
                <Notice tone="info">This photo was already filed, so nothing was added twice.</Notice>
              ) : result.status === "filed" && result.needsReview ? (
                <Notice tone="warn">Filed. The office will double-check it: {result.reviewReason}.</Notice>
              ) : result.status === "filed" ? (
                <Notice tone="ok">On the job&apos;s budget. Nothing else to do.</Notice>
              ) : (
                <Notice tone="info">
                  {result.kind === "quote"
                    ? "A price offered isn't money spent — it's with the job's quotes for the office."
                    : "No dollar total on it, so it's with the job's paperwork."}
                </Notice>
              )}
            </div>
          </div>
        </Sheet>
      )}

      {/* ---------- Saved, not filed ---------- */}
      {view === "unfinished" && (
        <Sheet title="Saved, not filed yet" onClose={close}>
          <div className="text-[12.5px] mb-4" style={{ color: v("muted") }}>
            These photos were saved but never filed. Finish each one, or clear the ones you don&apos;t need.
          </div>
          {unfinishedState === "loading" && unfinished.every((u) => !u.thumbUrl) && (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => <div key={i} className="h-[84px] rounded-2xl animate-pulse" style={{ background: v("bg-2") }} />)}
            </div>
          )}
          {unfinishedState === "error" && (
            <Notice tone="error">
              Couldn&apos;t load them.{" "}
              <button type="button" className="underline font-semibold" onClick={() => void refreshUnfinished(true)}>Try again</button>
            </Notice>
          )}
          {unfinishedState === "idle" && unfinished.length === 0 && (
            <Notice tone="ok">All caught up — nothing waiting.</Notice>
          )}
          {unfinishedState !== "loading" && (
            <div className="flex flex-col gap-2">
              {unfinished.map((row) => (
                <div
                  key={row.storagePath}
                  className="flex items-center gap-3 rounded-2xl p-2.5"
                  style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
                >
                  <Thumb src={row.thumbUrl} size={44} onOpen={() => { if (row.photoUrl) { setPhotoUrl(row.photoUrl); setViewerOpen(true); } }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium truncate">
                      {row.vendor ? `${row.vendor}${row.amount !== null ? ` · ${money(row.amount)}` : ""}` : "Receipt photo"}
                    </div>
                    <div className="text-[11.5px]" style={{ color: v("quiet") }}>Saved {savedAgo(row.savedAt)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => finishUnfinished(row)}
                    className="h-9 px-3.5 rounded-xl text-[13px] font-semibold shrink-0"
                    style={{ background: v("accent"), color: "#1a0f00" }}
                  >
                    Finish
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissUnfinished(row)}
                    aria-label="Clear this one"
                    className="h-9 w-8 flex items-center justify-center rounded-lg shrink-0 active:bg-white/5"
                    style={{ color: v("quiet") }}
                  >
                    <IconX className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
