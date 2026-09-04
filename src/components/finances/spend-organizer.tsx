"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  resolveCapture,
  discardCapture,
  requestSpendHelp,
  attachReceiptToCapture,
  bulkAssignSpend,
  splitSpend,
  listBudgetLinesForJob,
  type CaptureBudgetLine,
  type CaptureForReview,
  type CaptureJobOption,
} from "@/lib/actions/field-capture";
import { JobSearchSelect } from "@/components/finances/job-search-select";
import { BillUploadError, buildScanForm, readJsonResponse } from "@/lib/image/bill-upload";

/**
 * The triage workbench for every cost that still needs a home: flagged
 * receipts AND bank-statement lines with no project. Organized the way the
 * work actually goes — pick a vendor, see everything that vendor was paid,
 * point the batch at a job + budget line, done. Payment-method and month
 * filters cut the pile the other two ways Jorge thinks about it.
 *
 * Visual language: a dark ledger. Tabular numbers everywhere money shows,
 * payment methods color-coded (checks sky, ACH violet, plastic emerald),
 * amber reserved for selection + action so the eye follows the work.
 */

const money = (n: number | null): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

const METHOD_GROUPS = [
  { key: "all", label: "All" },
  { key: "check", label: "Checks" },
  { key: "ach", label: "ACH" },
  { key: "card", label: "Credit cards" },
] as const;
type MethodKey = (typeof METHOD_GROUPS)[number]["key"];

function methodGroupOf(row: CaptureForReview): Exclude<MethodKey, "all"> {
  const m = (row.payment_method ?? "").toLowerCase();
  if (m === "check") return "check";
  if (m === "ach") return "ach";
  return "card"; // credit_card, capital_one, amex, anything plastic
}

function methodChipLabel(row: CaptureForReview): string {
  const m = (row.payment_method ?? "").toLowerCase();
  if (m === "capital_one") return "Capital One";
  if (m === "credit_card") return "Card";
  if (m === "check") return "Check";
  if (m === "ach") return "ACH";
  return row.payment_method ?? "—";
}

const METHOD_CHIP_CLASS: Record<Exclude<MethodKey, "all">, string> = {
  check: "border-sky-500/25 bg-sky-500/10 text-sky-400",
  ach: "border-violet-500/25 bg-violet-500/10 text-violet-400",
  card: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
};

const UNKNOWN_GROUP = "Unknown checks (waiting on Nicole)";

/**
 * Group vendors that are the same business under one name: strip the
 * " — annotation" and "(remainder…)" suffixes the reconcile passes appended,
 * and collapse every UNKNOWN PAYEE check into one bucket — 79 one-row groups
 * would defeat the point of grouping.
 */
function vendorGroupOf(name: string): string {
  const raw = (name ?? "").trim();
  if (/^unknown payee/i.test(raw)) return UNKNOWN_GROUP;
  let base = raw.split("—")[0].trim();
  base = base.replace(/\([^)]*\)\s*$/, "").trim();
  return base.length > 0 ? base.toUpperCase() : "(no vendor)";
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthKeyOf(row: CaptureForReview): string | null {
  const d = row.invoice_date ?? row.created_at;
  if (!d) return null;
  return d.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const m = Number(key.slice(5, 7));
  return `${MONTHS[m - 1] ?? key} ${key.slice(2, 4)}`;
}

/* ----------------------------------------------------------------- split */

type SplitPiece = {
  projectId: string;
  lineItemId: string;
  amount: string;
  note: string;
};

function SplitPieceRow({
  piece,
  jobs,
  onChange,
  onRemove,
  removable,
}: {
  piece: SplitPiece;
  jobs: CaptureJobOption[];
  onChange: (next: SplitPiece) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const [lines, setLines] = useState<CaptureBudgetLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);

  useEffect(() => {
    if (!piece.projectId) {
      setLines([]);
      return;
    }
    let cancelled = false;
    setLoadingLines(true);
    listBudgetLinesForJob(piece.projectId)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece.projectId]);

  return (
    <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border/70 bg-background/40 p-2">
      <JobSearchSelect
        jobs={jobs}
        value={piece.projectId}
        onChange={(id) => onChange({ ...piece, projectId: id, lineItemId: "" })}
        placeholder="Job…"
        className="flex-1 min-w-[130px]"
      />
      <select
        value={piece.lineItemId}
        onChange={(e) => onChange({ ...piece, lineItemId: e.target.value })}
        disabled={loadingLines || !piece.projectId}
        className="h-8 rounded-lg border bg-background px-2 text-xs flex-1 min-w-[130px] disabled:opacity-50"
      >
        <option value="">
          {loadingLines ? "Loading…" : lines.length === 0 ? "No budget lines" : "Line (optional)"}
        </option>
        {lines.map((line) => (
          <option key={line.id} value={line.id}>
            {line.description}
            {line.trade ? ` · ${line.trade}` : ""}
          </option>
        ))}
      </select>
      <div className="flex h-8 items-center gap-1 rounded-lg border bg-background px-2">
        <span className="text-xs text-muted-foreground">$</span>
        <input
          value={piece.amount}
          onChange={(e) => onChange({ ...piece, amount: e.target.value })}
          inputMode="decimal"
          placeholder="0.00"
          className="w-20 bg-transparent text-xs tabular-nums outline-none"
        />
      </div>
      <input
        value={piece.note}
        onChange={(e) => onChange({ ...piece, note: e.target.value })}
        placeholder="note (e.g. client share)"
        className="h-8 rounded-lg border bg-background px-2 text-xs flex-1 min-w-[120px]"
      />
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          className="h-8 w-8 rounded-lg text-xs text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
          aria-label="Remove piece"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function SplitEditor({
  row,
  jobs,
  onDone,
  onCancel,
}: {
  row: CaptureForReview;
  jobs: CaptureJobOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const total = row.amount ?? 0;
  const half = Math.round((total / 2) * 100) / 100;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pieces, setPieces] = useState<SplitPiece[]>([
    {
      projectId: row.project_id ?? "",
      lineItemId: row.line_item_id ?? "",
      amount: String(half),
      note: "",
    },
    {
      projectId: "",
      lineItemId: "",
      amount: String(Math.round((total - half) * 100) / 100),
      note: "",
    },
  ]);

  const sum = pieces.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const balanced = Math.abs(sum - total) <= 0.01;
  const ready = balanced && pieces.every((p) => p.projectId && Number(p.amount) > 0);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await splitSpend({
        invoiceId: row.id,
        pieces: pieces.map((p) => ({
          projectId: p.projectId,
          lineItemId: p.lineItemId || null,
          amount: Number(p.amount),
          note: p.note.trim() || undefined,
        })),
      });
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-2.5 so-rise">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.14em] text-amber-500 font-semibold">
          Split across jobs
        </div>
        <div className="text-xs font-semibold tabular-nums">{money(total)}</div>
      </div>
      {pieces.map((piece, i) => (
        <SplitPieceRow
          key={i}
          piece={piece}
          jobs={jobs}
          onChange={(next) => setPieces((prev) => prev.map((p, j) => (j === i ? next : p)))}
          onRemove={() => setPieces((prev) => prev.filter((_, j) => j !== i))}
          removable={pieces.length > 2}
        />
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() =>
            setPieces((prev) => [...prev, { projectId: "", lineItemId: "", amount: "", note: "" }])
          }
          className="h-8 rounded-lg border border-dashed px-2.5 text-xs text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-foreground"
        >
          + Add piece
        </button>
        <span
          className={`text-xs tabular-nums font-medium ${balanced ? "text-emerald-400" : "text-red-400"}`}
        >
          {balanced ? `Balanced — ${money(sum)}` : `${money(sum)} of ${money(total)}`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-lg border px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !ready}
          className="h-8 rounded-lg bg-amber-600 px-3.5 text-xs font-semibold text-white shadow-sm shadow-amber-900/40 transition-colors hover:bg-amber-500 disabled:opacity-50"
        >
          {pending ? "Splitting…" : "Split it"}
        </button>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ rows */

function OrganizerRow({
  row,
  jobs,
  showVendor,
  checked,
  onToggle,
  index,
}: {
  row: CaptureForReview;
  jobs: CaptureJobOption[];
  showVendor: boolean;
  checked: boolean;
  onToggle: () => void;
  index: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  const receiptRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [askedNow, setAskedNow] = useState(false);
  const helpOpen = row.help_pending || askedNow;

  const [vendor, setVendor] = useState(row.vendor_name);
  const [amount, setAmount] = useState(row.amount === null ? "" : String(row.amount));
  const [projectId, setProjectId] = useState(row.project_id ?? "");
  const [lineItemId, setLineItemId] = useState(row.line_item_id ?? "");

  const movedJob = projectId !== (row.project_id ?? "");
  const [lines, setLines] = useState<CaptureBudgetLine[]>(row.budget_lines);
  const [loadingLines, setLoadingLines] = useState(false);

  useEffect(() => {
    if (!movedJob) {
      setLines(row.budget_lines);
      return;
    }
    if (!projectId) {
      setLines([]);
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
  }, [projectId, movedJob, row.budget_lines]);

  /**
   * Upload the actual receipt for a row that never had one. The file goes
   * through the existing office scanner, which stores it and reads it but
   * writes nothing to the books; we then bind it to THIS row and prefill
   * whatever it worked out, for Nicole to confirm. Never auto-saves — the
   * money is already booked, so a bad read must not move it on its own.
   */
  type ScanApiResponse = {
    scan?: { storagePath?: string; extractedText?: string | null; vendor?: string };
    job?: { id: string; label?: string } | null;
    allocations?: Array<{ lineItemId: string }>;
  };

  async function onReceiptPicked(file: File) {
    setError(null);
    setReadNote(null);
    setReading(true);
    try {
      // Shrinks the photo first — a raw iPhone photo is over Vercel's body
      // cap and died at the edge before the scan route ever ran.
      const form = await buildScanForm(file, projectId ? { projectId } : {});

      const res = await fetch("/api/bills/scan", { method: "POST", body: form });
      const { ok, json, error: readError } = await readJsonResponse<ScanApiResponse>(res);
      if (!ok || !json) {
        setError(readError ?? "Could not read that file.");
        return;
      }

      const bind = await attachReceiptToCapture({
        invoiceId: row.id,
        storagePath: json.scan?.storagePath ?? "",
        extractedText: json.scan?.extractedText ?? null,
      });
      if (bind.error) {
        setError(bind.error);
        return;
      }

      // Prefill only — the amount stays as the bank recorded it, since that
      // is the money that actually moved.
      const suggestedJob: string | null = json.job?.id ?? null;
      const suggestedLine: string | null = json.allocations?.[0]?.lineItemId ?? null;
      if (suggestedJob) {
        setProjectId(suggestedJob);
        setLineItemId(suggestedLine ?? "");
      }
      setReadNote(
        suggestedJob
          ? `Read it: ${json.scan?.vendor ?? "vendor"}${
              json.job?.label ? ` on ${json.job.label}` : ""
            }${suggestedLine ? " — line prefilled" : " — pick the line"}. Check it, then Confirm.`
          : `Read it: ${json.scan?.vendor ?? "vendor"}. It could not tell the job — pick one.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof BillUploadError ? err.message : "Upload failed. Try again.");
    } finally {
      setReading(false);
    }
  }

  function askForHelp() {
    setError(null);
    const note = window.prompt(
      "What should Jorge or Ryan know? (optional — e.g. \"card charge, no receipt\")",
      "",
    );
    if (note === null) return; // cancelled
    startTransition(async () => {
      const result = await requestSpendHelp({ invoiceId: row.id, note });
      if (result.error) setError(result.error);
      else {
        setAskedNow(true);
        router.refresh();
      }
    });
  }

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
        invoiceId: row.id,
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
      const result = await discardCapture(row.id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  const method = methodGroupOf(row);

  return (
    <div
      className={`so-rise group rounded-xl border bg-card p-3 flex gap-3 transition-all ${
        checked
          ? "border-amber-500/50 bg-amber-500/[0.04] shadow-sm shadow-amber-950/30"
          : "border-border/80 hover:border-amber-500/25"
      }`}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1.5 h-4 w-4 shrink-0 accent-amber-600 cursor-pointer"
        aria-label="Include in bulk assign"
      />

      {row.photo_url && (
        <button
          type="button"
          onClick={() => setZoom(true)}
          className="shrink-0 h-14 w-14 rounded-lg overflow-hidden border transition-transform hover:scale-105"
          aria-label="View the receipt photo full size"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={row.photo_url} alt="receipt" className="h-full w-full object-cover" />
        </button>
      )}

      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-left text-[13px] font-semibold truncate block max-w-full transition-colors hover:text-amber-500"
              title={row.vendor_name}
            >
              {showVendor ? row.vendor_name : row.description?.slice(0, 90) || row.vendor_name}
            </button>
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground mt-1">
              <span className="tabular-nums">{row.invoice_date ?? "no date"}</span>
              <span
                className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${METHOD_CHIP_CLASS[method]}`}
              >
                {methodChipLabel(row)}
              </span>
              {row.review_reason && (
                <span className="inline-flex items-center gap-1 text-amber-500">
                  <span className="h-1 w-1 rounded-full bg-amber-500" />
                  {row.review_reason}
                </span>
              )}
              {row.project_id && <span className="truncate">{row.project_label}</span>}
              {helpOpen && (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-px text-[10px] font-medium text-sky-300">
                  Asked Jorge &amp; Ryan
                </span>
              )}
              {row.has_receipt && (
                <span className="text-[10px] text-emerald-400/80">receipt on file</span>
              )}
            </div>
            {helpOpen && (
              <div className="mt-1 text-[11px] text-sky-300/90">
                {row.who_asked_for_help
                  ? `${row.who_asked_for_help} asked for help placing this.`
                  : "Waiting on Jorge or Ryan to place this."}
                {row.help_note ? ` "${row.help_note}"` : ""}
              </div>
            )}
            {readNote && <div className="mt-1 text-[11px] text-amber-400">{readNote}</div>}
          </div>
          <div className="text-right shrink-0 text-[15px] font-semibold tabular-nums">
            {money(row.amount)}
          </div>
        </div>

        {expanded && (
          <div className="grid gap-2 sm:grid-cols-2 so-rise">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                Vendor
              </span>
              <input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="h-8 rounded-lg border bg-background px-2.5 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                Amount
              </span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="h-8 rounded-lg border bg-background px-2.5 text-xs tabular-nums"
              />
            </label>
            {row.description && (
              <div className="sm:col-span-2 text-xs text-muted-foreground leading-relaxed">
                {row.description}
              </div>
            )}
          </div>
        )}

        {splitting && (
          <SplitEditor
            row={row}
            jobs={jobs}
            onDone={() => {
              setSplitting(false);
              router.refresh();
            }}
            onCancel={() => setSplitting(false)}
          />
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <JobSearchSelect
            jobs={jobs}
            value={projectId}
            onChange={(id) => {
              setProjectId(id);
              setLineItemId("");
            }}
            placeholder="No job"
            allowNone
            className="flex-1 min-w-[140px] max-w-[46%]"
          />
          <select
            value={lineItemId}
            onChange={(e) => setLineItemId(e.target.value)}
            disabled={loadingLines || !projectId}
            className="h-8 rounded-lg border bg-background px-2 text-xs max-w-[46%] disabled:opacity-50"
          >
            <option value="">
              {loadingLines
                ? "Loading lines…"
                : lines.length === 0
                  ? "No budget lines"
                  : "Unassigned line"}
            </option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.description}
                {line.trade ? ` · ${line.trade}` : ""}
              </option>
            ))}
          </select>
          <button
            onClick={confirm}
            disabled={pending}
            className="h-8 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white shadow-sm shadow-amber-900/40 transition-colors hover:bg-amber-500 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Confirm"}
          </button>
          <button
            onClick={() => setSplitting((v) => !v)}
            disabled={pending || !row.amount}
            className={`h-8 rounded-lg border px-3 text-xs transition-colors disabled:opacity-50 ${
              splitting
                ? "border-amber-500/50 text-amber-500"
                : "text-muted-foreground hover:border-amber-500/40 hover:text-foreground"
            }`}
          >
            Split
          </button>
          {row.is_bank_row ? (
            <span
              className="text-[10px] uppercase tracking-wide text-muted-foreground/60"
              title="Real money that cleared the bank — assign it, don't delete it"
            >
              bank line
            </span>
          ) : (
            <button
              onClick={discard}
              disabled={pending}
              className="h-8 rounded-lg border px-3 text-xs text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
            >
              Discard
            </button>
          )}
          <input
            ref={receiptRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // let the same file be re-picked after a failure
              if (file) void onReceiptPicked(file);
            }}
          />
          <button
            onClick={() => receiptRef.current?.click()}
            disabled={reading || pending}
            title="Photograph or upload the receipt — the AI reads it and fills in the job and line"
            className="h-8 rounded-lg border px-3 text-xs text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-foreground disabled:opacity-50"
          >
            {reading ? "Reading…" : row.has_receipt ? "Replace receipt" : "Add receipt"}
          </button>
          <button
            onClick={askForHelp}
            disabled={pending || helpOpen}
            title={
              helpOpen
                ? "Jorge and Ryan have already been asked about this one"
                : "Send this to Jorge and Ryan to place"
            }
            className={`h-8 rounded-lg border px-3 text-xs transition-colors disabled:opacity-50 ${
              helpOpen
                ? "border-sky-500/40 text-sky-300"
                : "text-muted-foreground hover:border-sky-500/40 hover:text-sky-300"
            }`}
          >
            {helpOpen ? "Help asked" : "Ask for help"}
          </button>
          <div className="flex-1" />
          <Link
            href={`/spent/${row.id}`}
            className="text-[11px] text-muted-foreground transition-colors hover:text-amber-500 underline underline-offset-2 decoration-border"
          >
            Open bill
          </Link>
          {row.project_id && (
            <Link
              href={`/projects/${row.project_id}?tab=finances`}
              className="text-[11px] text-muted-foreground transition-colors hover:text-amber-500 underline underline-offset-2 decoration-border"
            >
              Open job
            </Link>
          )}
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>

      {/* Portaled: the row runs the .so-rise transform animation, which turns the
          card into the containing block for position:fixed, so an in-flow
          overlay was trapped inside the 14px-tall row instead of covering the
          viewport. Same fix JobSearchSelect uses for its menu. */}
      {zoom &&
        row.photo_url &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
            onClick={() => setZoom(false)}
            role="dialog"
            aria-modal="true"
            aria-label={`${row.vendor_name} receipt`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={row.photo_url}
              alt={`${row.vendor_name} receipt`}
              className="max-h-full max-w-full object-contain rounded-md shadow-2xl"
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ------------------------------------------------------------- workbench */

export function SpendOrganizer({
  rows,
  jobs,
}: {
  rows: CaptureForReview[];
  jobs: CaptureJobOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [method, setMethod] = useState<MethodKey>("all");
  const [month, setMonth] = useState<string>("all");
  const [vendorGroup, setVendorGroup] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkJob, setBulkJob] = useState("");
  const [bulkLine, setBulkLine] = useState("");
  const [bulkLines, setBulkLines] = useState<CaptureBudgetLine[]>([]);
  const [loadingBulkLines, setLoadingBulkLines] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Method + month cut the pile; the vendor rail reflects that cut so its
  // counts always describe what clicking will show.
  const methodMonthRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (method === "all" || methodGroupOf(r) === method) &&
          (month === "all" || monthKeyOf(r) === month),
      ),
    [rows, method, month],
  );

  const vendorGroups = useMemo(() => {
    const map = new Map<string, { label: string; count: number; total: number }>();
    for (const r of methodMonthRows) {
      const key = vendorGroupOf(r.vendor_name);
      const entry = map.get(key) ?? { label: key, count: 0, total: 0 };
      entry.count += 1;
      entry.total += r.amount ?? 0;
      map.set(key, entry);
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => {
        // Unknown checks always sink to the bottom — they're Nicole's pile.
        if (a.key === UNKNOWN_GROUP) return 1;
        if (b.key === UNKNOWN_GROUP) return -1;
        return b.total - a.total;
      });
  }, [methodMonthRows]);

  const months = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = monthKeyOf(r);
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const methodTotals = useMemo(() => {
    const totals = { check: 0, ach: 0, card: 0 } as Record<Exclude<MethodKey, "all">, number>;
    const counts = { check: 0, ach: 0, card: 0 } as Record<Exclude<MethodKey, "all">, number>;
    for (const r of rows) {
      const g = methodGroupOf(r);
      totals[g] += r.amount ?? 0;
      counts[g] += 1;
    }
    return { totals, counts };
  }, [rows]);

  const grandTotal = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  const visibleRows = useMemo(
    () =>
      vendorGroup === "all"
        ? methodMonthRows
        : methodMonthRows.filter((r) => vendorGroupOf(r.vendor_name) === vendorGroup),
    [methodMonthRows, vendorGroup],
  );

  const visibleTotal = visibleRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  // A stale selection silently bulk-assigns rows that are no longer on
  // screen — clear it whenever the visible set changes shape.
  useEffect(() => {
    setSelected(new Set());
  }, [method, month, vendorGroup]);

  useEffect(() => {
    if (!bulkJob) {
      setBulkLines([]);
      setBulkLine("");
      return;
    }
    let cancelled = false;
    setLoadingBulkLines(true);
    listBudgetLinesForJob(bulkJob)
      .then((lines) => {
        if (!cancelled) setBulkLines(lines);
      })
      .catch(() => {
        if (!cancelled) setBulkLines([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBulkLines(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bulkJob]);

  const allChecked = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));
  const selectedRows = visibleRows.filter((r) => selected.has(r.id));
  const selectedCount = selectedRows.length;
  const selectedTotal = selectedRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(visibleRows.map((r) => r.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function assignSelected() {
    setBulkError(null);
    if (!bulkJob) {
      setBulkError("Pick a job first");
      return;
    }
    const ids = selectedRows.map((r) => r.id);
    if (ids.length === 0) {
      setBulkError("Check the rows to assign");
      return;
    }
    startTransition(async () => {
      const result = await bulkAssignSpend({
        invoiceIds: ids,
        projectId: bulkJob,
        lineItemId: bulkLine || null,
      });
      if (result.error) setBulkError(result.error);
      else {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center so-rise">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
          ✓
        </div>
        <div className="text-sm font-semibold">Nothing to sort out</div>
        <div className="text-xs text-muted-foreground mt-1">
          Every cost has a job and a clean read. Nice.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Control deck: headline + method segments + month chips */}
      <div className="rounded-xl border bg-card p-3.5 flex flex-col gap-3 so-rise">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
              To sort out
            </div>
            <div className="text-2xl font-bold tabular-nums leading-tight">
              {money(grandTotal)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {rows.length} transactions
              </span>
            </div>
          </div>
          <div className="flex gap-1 rounded-lg border bg-background p-0.5">
            {METHOD_GROUPS.map((m) => {
              const count =
                m.key === "all"
                  ? rows.length
                  : methodTotals.counts[m.key as Exclude<MethodKey, "all">];
              if (m.key !== "all" && count === 0) return null;
              return (
                <button
                  key={m.key}
                  onClick={() => setMethod(m.key)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    method === m.key
                      ? "bg-amber-600 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.label}
                  <span
                    className={`ml-1.5 tabular-nums ${method === m.key ? "text-amber-100" : "text-muted-foreground/60"}`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setMonth("all")}
            className={`rounded-full border px-2.5 py-1 text-[11px] tabular-nums transition-colors ${
              month === "all"
                ? "border-foreground bg-foreground text-background font-semibold"
                : "text-muted-foreground hover:border-amber-500/40"
            }`}
          >
            All months
          </button>
          {months.map(([key, count]) => (
            <button
              key={key}
              onClick={() => setMonth(key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] tabular-nums transition-colors ${
                month === key
                  ? "border-foreground bg-foreground text-background font-semibold"
                  : "text-muted-foreground hover:border-amber-500/40"
              }`}
            >
              {monthLabel(key)} · {count}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[290px_1fr] items-start">
        {/* Vendor rail */}
        <aside className="rounded-xl border bg-card overflow-hidden lg:sticky lg:top-4 so-rise">
          <div className="flex items-center justify-between px-3 py-2.5 border-b bg-muted/20">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
              Vendors
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {vendorGroups.length}
            </span>
          </div>
          <div className="max-h-[62vh] overflow-y-auto">
            <button
              onClick={() => setVendorGroup("all")}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left border-l-2 transition-colors ${
                vendorGroup === "all"
                  ? "border-l-amber-500 bg-amber-500/10"
                  : "border-l-transparent hover:bg-muted/30"
              }`}
            >
              <span
                className={`text-[13px] ${vendorGroup === "all" ? "font-semibold text-amber-500" : ""}`}
              >
                All vendors
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                {methodMonthRows.length}
              </span>
            </button>
            {vendorGroups.map((g) => {
              const active = vendorGroup === g.key;
              const isUnknown = g.key === UNKNOWN_GROUP;
              return (
                <button
                  key={g.key}
                  onClick={() => setVendorGroup(g.key)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left border-l-2 transition-colors ${
                    active
                      ? "border-l-amber-500 bg-amber-500/10"
                      : "border-l-transparent hover:bg-muted/30"
                  } ${isUnknown ? "border-t border-t-border/60 border-dashed opacity-80" : ""}`}
                >
                  <span
                    className={`text-[12.5px] truncate min-w-0 ${
                      active ? "font-semibold text-amber-500" : ""
                    } ${isUnknown ? "italic" : ""}`}
                    title={g.label}
                  >
                    {g.label}
                  </span>
                  <span className="shrink-0 text-right leading-tight">
                    <span className="block text-[11.5px] font-semibold tabular-nums">
                      {money(g.total)}
                    </span>
                    <span className="block text-[10px] tabular-nums text-muted-foreground">
                      {g.count} item{g.count === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Rows + bulk bar */}
        <section className="flex flex-col gap-3 min-w-0">
          <div
            className={`rounded-xl border p-2.5 flex items-center gap-2 flex-wrap sticky top-0 z-10 backdrop-blur-md transition-colors ${
              selectedCount > 0
                ? "border-amber-500/50 bg-card/95 shadow-lg shadow-amber-950/20"
                : "border-border/80 bg-card/95"
            }`}
          >
            <label className="flex h-8 items-center gap-2 rounded-lg border bg-background px-2.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="h-4 w-4 accent-amber-600 cursor-pointer"
              />
              {selectedCount > 0 ? (
                <span className="tabular-nums font-medium text-foreground">
                  {selectedCount} · {money(selectedTotal)}
                </span>
              ) : (
                "Select all"
              )}
            </label>
            <JobSearchSelect
              jobs={jobs}
              value={bulkJob}
              onChange={setBulkJob}
              placeholder="Assign to job…"
              className="flex-1 min-w-[140px]"
            />
            <select
              value={bulkLine}
              onChange={(e) => setBulkLine(e.target.value)}
              disabled={!bulkJob || loadingBulkLines}
              className="h-8 rounded-lg border bg-background px-2 text-xs flex-1 min-w-[140px] disabled:opacity-50"
            >
              <option value="">
                {loadingBulkLines
                  ? "Loading lines…"
                  : bulkLines.length === 0
                    ? "No budget lines"
                    : "Budget line (optional)"}
              </option>
              {bulkLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.description}
                  {line.trade ? ` · ${line.trade}` : ""}
                </option>
              ))}
            </select>
            <button
              onClick={assignSelected}
              disabled={pending || selectedCount === 0}
              className="h-8 rounded-lg bg-amber-600 px-3.5 text-xs font-semibold text-white shadow-sm shadow-amber-900/40 transition-colors hover:bg-amber-500 disabled:opacity-40"
            >
              {pending ? "Assigning…" : selectedCount > 0 ? `Assign ${selectedCount}` : "Assign"}
            </button>
            {bulkError && <div className="w-full text-xs text-red-400">{bulkError}</div>}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>
              {vendorGroup === "all" ? "All vendors" : vendorGroup}
              {method !== "all" &&
                ` · ${METHOD_GROUPS.find((m) => m.key === method)?.label ?? method}`}
              {month !== "all" && ` · ${monthLabel(month)}`}
              {" · "}
              <span className="tabular-nums">
                {visibleRows.length} transaction{visibleRows.length === 1 ? "" : "s"}
              </span>
            </span>
            <span className="font-semibold tabular-nums text-foreground">{money(visibleTotal)}</span>
          </div>

          {vendorGroup === UNKNOWN_GROUP && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-3 text-xs text-muted-foreground leading-relaxed so-rise">
              These checks cleared the bank but the statement doesn&apos;t show who they
              went to. Nicole has the list — assign the ones you recognize, leave the
              rest for her.
            </div>
          )}

          {visibleRows.map((row, i) => (
            <OrganizerRow
              key={row.id}
              row={row}
              jobs={jobs}
              showVendor={vendorGroup === "all" || vendorGroup === UNKNOWN_GROUP}
              checked={selected.has(row.id)}
              onToggle={() => toggleOne(row.id)}
              index={i}
            />
          ))}
        </section>
      </div>
    </div>
  );
}
