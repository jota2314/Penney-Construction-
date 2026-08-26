"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  resolveCapture,
  discardCapture,
  bulkAssignSpend,
  listBudgetLinesForJob,
  type CaptureBudgetLine,
  type CaptureForReview,
  type CaptureJobOption,
} from "@/lib/actions/field-capture";

/**
 * The triage workbench for every cost that still needs a home: flagged
 * receipts AND bank-statement lines with no project. Organized the way the
 * work actually goes — pick a vendor, see everything that vendor was paid,
 * point the batch at a job + budget line, done. Payment-method and month
 * filters cut the pile the other two ways Jorge thinks about it.
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

/* ------------------------------------------------------------------ rows */

function OrganizerRow({
  row,
  jobs,
  showVendor,
  checked,
  onToggle,
}: {
  row: CaptureForReview;
  jobs: CaptureJobOption[];
  showVendor: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(false);

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

  function confirm() {
    setError(null);
    const parsed = amount.trim() === "" ? undefined : Number(amount);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed <= 0)) {
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

  return (
    <div className="rounded-xl border bg-card p-3 flex gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1.5 h-4 w-4 shrink-0 accent-amber-600"
        aria-label="Include in bulk assign"
      />

      {row.photo_url && (
        <button
          type="button"
          onClick={() => setZoom(true)}
          className="shrink-0 h-14 w-14 rounded-lg overflow-hidden border"
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
              className="text-left text-sm font-medium truncate block max-w-full"
              title={row.vendor_name}
            >
              {showVendor ? row.vendor_name : row.description?.slice(0, 90) || row.vendor_name}
            </button>
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground mt-0.5">
              <span>{row.invoice_date ?? "no date"}</span>
              <span className="rounded-full border px-1.5 py-px">{methodChipLabel(row)}</span>
              {row.review_reason && (
                <span className="text-amber-600">{row.review_reason}</span>
              )}
              {row.project_id && <span>{row.project_label}</span>}
            </div>
          </div>
          <div className="text-right shrink-0 text-sm font-semibold">{money(row.amount)}</div>
        </div>

        {expanded && (
          <div className="grid gap-2 sm:grid-cols-2">
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
                className="rounded-lg border bg-background px-2.5 py-1.5 text-sm"
              />
            </label>
            {row.description && (
              <div className="sm:col-span-2 text-xs text-muted-foreground">{row.description}</div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setLineItemId("");
            }}
            className="rounded-lg border bg-background px-2 py-1.5 text-xs max-w-[46%]"
          >
            <option value="">No job</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.internal ? `★ ${job.label}` : job.label}
              </option>
            ))}
          </select>
          <select
            value={lineItemId}
            onChange={(e) => setLineItemId(e.target.value)}
            disabled={loadingLines || !projectId}
            className="rounded-lg border bg-background px-2 py-1.5 text-xs max-w-[46%] disabled:opacity-50"
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
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Confirm"}
          </button>
          {row.is_bank_row ? (
            <span className="text-[11px] text-muted-foreground">bank line — can’t delete</span>
          ) : (
            <button
              onClick={discard}
              disabled={pending}
              className="rounded-lg border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50"
            >
              Discard
            </button>
          )}
          <Link
            href={`/spent/${row.id}`}
            className="text-[11px] text-muted-foreground underline underline-offset-2"
          >
            Open bill
          </Link>
          {row.project_id && (
            <Link
              href={`/projects/${row.project_id}?tab=finances`}
              className="text-[11px] text-muted-foreground underline underline-offset-2"
            >
              Open job
            </Link>
          )}
        </div>

        {error && <div className="text-xs text-red-500">{error}</div>}
      </div>

      {zoom && row.photo_url && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoom(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={row.photo_url}
            alt={`${row.vendor_name} receipt`}
            className="max-h-full max-w-full object-contain"
          />
        </div>
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
    const ids = visibleRows.filter((r) => selected.has(r.id)).map((r) => r.id);
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
      <div className="rounded-xl border bg-card p-8 text-center">
        <div className="text-sm font-medium">Nothing to sort out</div>
        <div className="text-xs text-muted-foreground mt-1">
          Every cost has a job and a clean read. Nice.
        </div>
      </div>
    );
  }

  const selectedCount = visibleRows.filter((r) => selected.has(r.id)).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Payment method + month filters */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 flex-wrap">
          {METHOD_GROUPS.map((m) => {
            const count =
              m.key === "all"
                ? rows.length
                : rows.filter((r) => methodGroupOf(r) === m.key).length;
            if (m.key !== "all" && count === 0) return null;
            return (
              <button
                key={m.key}
                onClick={() => setMethod(m.key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  method === m.key
                    ? "bg-amber-600 border-amber-600 text-white"
                    : "text-muted-foreground"
                }`}
              >
                {m.label} · {count}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setMonth("all")}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${
              month === "all" ? "bg-foreground text-background" : "text-muted-foreground"
            }`}
          >
            All months
          </button>
          {months.map(([key, count]) => (
            <button
              key={key}
              onClick={() => setMonth(key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                month === key ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
            >
              {monthLabel(key)} · {count}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr] items-start">
        {/* Vendor rail */}
        <aside className="rounded-xl border bg-card overflow-hidden lg:sticky lg:top-4">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold border-b">
            Vendors
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <button
              onClick={() => setVendorGroup("all")}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm border-b ${
                vendorGroup === "all" ? "bg-amber-600/10 text-amber-600 font-semibold" : ""
              }`}
            >
              <span>All vendors</span>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {methodMonthRows.length}
              </span>
            </button>
            {vendorGroups.map((g) => (
              <button
                key={g.key}
                onClick={() => setVendorGroup(g.key)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left border-b last:border-b-0 ${
                  vendorGroup === g.key ? "bg-amber-600/10" : ""
                }`}
              >
                <span
                  className={`text-sm truncate min-w-0 ${
                    vendorGroup === g.key ? "text-amber-600 font-semibold" : ""
                  }`}
                  title={g.label}
                >
                  {g.label}
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0 text-right">
                  {g.count} · {money(g.total)}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Rows + bulk bar */}
        <section className="flex flex-col gap-3 min-w-0">
          <div className="rounded-xl border bg-card p-3 flex items-center gap-2 flex-wrap sticky top-0 z-10">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="h-4 w-4 accent-amber-600"
              />
              {selectedCount > 0 ? `${selectedCount} selected` : "Select all shown"}
            </label>
            <select
              value={bulkJob}
              onChange={(e) => setBulkJob(e.target.value)}
              className="rounded-lg border bg-background px-2 py-1.5 text-xs flex-1 min-w-[140px]"
            >
              <option value="">Assign to job…</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.internal ? `★ ${job.label}` : job.label}
                </option>
              ))}
            </select>
            <select
              value={bulkLine}
              onChange={(e) => setBulkLine(e.target.value)}
              disabled={!bulkJob || loadingBulkLines}
              className="rounded-lg border bg-background px-2 py-1.5 text-xs flex-1 min-w-[140px] disabled:opacity-50"
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
              className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Assigning…" : `Assign ${selectedCount || ""}`}
            </button>
            {bulkError && <div className="w-full text-xs text-red-500">{bulkError}</div>}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>
              {vendorGroup === "all" ? "All vendors" : vendorGroup}
              {method !== "all" &&
                ` · ${METHOD_GROUPS.find((m) => m.key === method)?.label ?? method}`}
              {month !== "all" && ` · ${monthLabel(month)}`}
              {" · "}
              {visibleRows.length} transaction{visibleRows.length === 1 ? "" : "s"}
            </span>
            <span className="font-semibold text-foreground">{money(visibleTotal)}</span>
          </div>

          {vendorGroup === UNKNOWN_GROUP && (
            <div className="rounded-xl border border-amber-600/40 bg-amber-600/5 p-3 text-xs text-muted-foreground">
              These checks cleared the bank but the statement doesn&apos;t show who they
              went to. Nicole has the list — assign the ones you recognize, leave the
              rest for her.
            </div>
          )}

          {visibleRows.map((row) => (
            <OrganizerRow
              key={row.id}
              row={row}
              jobs={jobs}
              showVendor={vendorGroup === "all" || vendorGroup === UNKNOWN_GROUP}
              checked={selected.has(row.id)}
              onToggle={() => toggleOne(row.id)}
            />
          ))}
        </section>
      </div>
    </div>
  );
}
