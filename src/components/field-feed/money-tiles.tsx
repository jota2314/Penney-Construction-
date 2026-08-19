"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { v } from "@/components/field-feed/tokens";
import { BillDrop } from "@/components/invoices/bill-drop";
import { DepositCapture } from "@/components/field-feed/deposit-capture";
import {
  listRecentReceiptCaptures,
  listRecentDeposits,
  assignCaptureToLine,
  type ReceiptCaptureRow,
  type DepositRow,
  type CaptureLineOption,
} from "@/lib/actions/money-tiles";

/**
 * The Command Center's Receipts and Deposits tiles.
 *
 * Tapping one opens the ledger of what's actually been captured — the photo,
 * the amount, the job, WHO took it, and which budget line it landed on —
 * with the scanner sitting at the top. The first cut sent you straight to the
 * camera, which meant the crew could file receipts all day and nobody could
 * see them without going hunting through /spent.
 *
 * The budget line is a live picker on every row, so a receipt that landed
 * unassigned gets placed here rather than in a separate queue.
 */

const money = (n: number | null): string =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";

const fmtCompact = (n: number): string =>
  n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;

const fmtDay = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const firstName = (full: string | null): string =>
  full?.trim().split(/\s+/)[0] ?? "Someone";

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function Tile({
  label,
  headline,
  sub,
  tint,
  icon,
  alert,
  onClick,
  compact,
  ariaLabel,
}: {
  label: string;
  headline: string;
  sub: string;
  tint: string;
  icon: React.ReactNode;
  alert: boolean;
  onClick: () => void;
  compact: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl text-left transition active:scale-[0.99] ${
        compact
          ? "flex min-w-0 flex-col items-center gap-1.5 px-2 py-2.5 text-center"
          : "flex items-center gap-3 px-4 py-3.5"
      }`}
      style={
        compact
          ? { background: "transparent" }
          : { background: v("card"), border: `1px solid ${v("line")}` }
      }
      aria-haspopup="dialog"
      aria-label={ariaLabel}
    >
      <span
        className={`${compact ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl"} flex items-center justify-center shrink-0`}
        style={{ background: `${tint}22`, color: tint }}
      >
        {icon}
      </span>
      <span className={compact ? "min-w-0" : "flex-1 min-w-0"}>
        <span
          className="block text-[10px] font-medium uppercase"
          style={{ color: v("quiet"), letterSpacing: "0.18em" }}
        >
          {label}
        </span>
        <span
          className={`mt-0.5 block font-semibold leading-tight ${compact ? "text-[20px]" : "text-[16px]"}`}
          style={{ color: alert ? "#FBBF24" : v("ink") }}
        >
          {headline}
        </span>
        <span
          className={`block font-medium ${compact ? "text-[10px]" : "text-[11px]"}`}
          style={{ color: v("quiet") }}
        >
          {sub}
        </span>
      </span>
      <span className={compact ? "sr-only" : "text-[12px] font-semibold"} style={{ color: tint }}>
        Open
      </span>
    </button>
  );
}

function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92dvh] overflow-hidden"
        style={{ background: v("card"), border: `1px solid ${v("line")}`, color: v("ink") }}
      >
        <div
          className="flex items-center justify-between gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: `1px solid ${v("line")}` }}
        >
          <div className="min-w-0">
            <div
              className="text-[11px] font-medium uppercase"
              style={{ color: v("quiet"), letterSpacing: "0.18em" }}
            >
              {title}
            </div>
            <div className="text-[12px] mt-0.5 truncate" style={{ color: v("muted") }}>
              {subtitle}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] px-2 py-1 rounded-lg shrink-0"
            style={{ color: v("muted") }}
          >
            Close
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-4 py-3 shrink-0" style={{ borderTop: `1px solid ${v("line")}` }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function Thumb({ url, alt, onZoom }: { url: string | null; alt: string; onZoom: () => void }) {
  if (!url) {
    return (
      <div
        className="h-16 w-16 shrink-0 rounded-lg flex items-center justify-center text-[10px] text-center leading-tight"
        style={{ background: v("bg-2"), color: v("quiet") }}
      >
        No photo
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onZoom}
      className="h-16 w-16 shrink-0 rounded-lg overflow-hidden"
      style={{ background: v("bg-2") }}
      aria-label="View the photo full size"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="h-full w-full object-cover" />
    </button>
  );
}

function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

function Empty({ line, hint }: { line: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-10">
      <div className="text-[14px] font-medium">{line}</div>
      <div className="text-[12px] mt-1" style={{ color: v("quiet") }}>
        {hint}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/**
 * Budget-line picker as an in-app overlay, NOT a native <select>. The native
 * option list can't be styled — on dark theme it rendered as a wall of
 * blue link-colored text stretched across the page. This one matches the
 * sheet: dark card, search box, one tappable row per line, trade tag on the
 * right, check on the current pick.
 */
function LinePicker({
  lines,
  currentId,
  vendorLabel,
  onPick,
  onClose,
}: {
  lines: CaptureLineOption[];
  currentId: string;
  vendorLabel: string;
  onPick: (lineId: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? lines.filter(
        (line) =>
          line.description.toLowerCase().includes(q) ||
          (line.trade ?? "").toLowerCase().includes(q),
      )
    : lines;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[82dvh] overflow-hidden"
        style={{ background: v("card"), border: `1px solid ${v("line")}`, color: v("ink") }}
      >
        <div
          className="px-4 py-3.5 shrink-0 flex items-center justify-between gap-3"
          style={{ borderBottom: `1px solid ${v("line")}` }}
        >
          <div className="min-w-0">
            <div
              className="text-[11px] font-medium uppercase"
              style={{ color: v("quiet"), letterSpacing: "0.18em" }}
            >
              Charge to
            </div>
            <div className="text-[12px] mt-0.5 truncate" style={{ color: v("muted") }}>
              {vendorLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] px-2 py-1 rounded-lg shrink-0"
            style={{ color: v("muted") }}
          >
            Cancel
          </button>
        </div>

        {lines.length > 6 && (
          <div className="px-3 pt-3 shrink-0">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search budget lines"
              autoFocus
              className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none"
              style={{
                background: v("bg-2"),
                border: `1px solid ${v("line")}`,
                color: v("ink"),
              }}
            />
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-1.5">
          {currentId && (
            <button
              type="button"
              onClick={() => onPick(null)}
              className="w-full text-left rounded-xl px-3 py-2.5 transition active:scale-[0.99]"
              style={{ background: v("bg-2"), border: `1px solid ${v("line")}` }}
            >
              <span className="text-[13px]" style={{ color: v("muted") }}>
                Remove from its budget line
              </span>
            </button>
          )}
          {filtered.map((line) => {
            const selected = line.id === currentId;
            return (
              <button
                key={line.id}
                type="button"
                onClick={() => onPick(line.id)}
                className="w-full text-left rounded-xl px-3 py-2.5 transition active:scale-[0.99] flex items-center gap-2.5"
                style={{
                  background: selected ? "rgba(217,119,6,0.12)" : v("bg-2"),
                  border: `1px solid ${selected ? "rgba(217,119,6,0.45)" : v("line")}`,
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium leading-snug line-clamp-2">
                    {line.description}
                  </span>
                  {line.trade && (
                    <span
                      className="mt-1 inline-block text-[10px] font-semibold uppercase rounded-full px-2 py-0.5"
                      style={{
                        background: "rgba(217,119,6,0.14)",
                        color: v("accent"),
                        letterSpacing: "0.08em",
                      }}
                    >
                      {line.trade}
                    </span>
                  )}
                </span>
                {selected && (
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    className="w-4 h-4 shrink-0"
                    style={{ color: v("accent") }}
                  >
                    <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-[13px] text-center py-6" style={{ color: v("quiet") }}>
              No lines match that.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReceiptRow({ row, onChanged }: { row: ReceiptCaptureRow; onChanged: () => void }) {
  const [lineId, setLineId] = useState(row.line_item_id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [picking, setPicking] = useState(false);

  const unassigned = !lineId;
  const currentLine = row.budget_lines.find((line) => line.id === lineId);
  const currentLabel =
    currentLine?.description ?? (lineId ? (row.line_item_label ?? "On a budget line") : null);

  function pickLine(next: string | null) {
    setPicking(false);
    setLineId(next ?? "");
    setError(null);
    startTransition(async () => {
      const result = await assignCaptureToLine(row.id, next);
      if (result.error) {
        setError(result.error);
        setLineId(row.line_item_id ?? "");
      } else {
        onChanged();
      }
    });
  }

  return (
    <div className="px-4 py-3.5" style={{ borderTop: `1px solid ${v("line-soft")}` }}>
      <div className="flex gap-3">
        <Thumb
          url={row.photo_url}
          alt={`${row.vendor_name} receipt`}
          onZoom={() => setZoom(true)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] font-semibold truncate">{row.vendor_name}</span>
            <span className="text-[14px] font-semibold shrink-0 tabular-nums">
              {money(row.amount)}
            </span>
          </div>
          <div className="text-[11.5px] mt-0.5 truncate" style={{ color: v("muted") }}>
            {row.project_label}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: v("quiet") }}>
            {firstName(row.captured_by)} · {fmtDay(row.invoice_date ?? row.captured_at)}
          </div>

          <div className="mt-2">
            <button
              type="button"
              disabled={pending || row.budget_lines.length === 0}
              onClick={() => setPicking(true)}
              className="w-full text-left rounded-lg px-2.5 py-2 text-[12px] transition active:scale-[0.99] disabled:opacity-60 flex items-center justify-between gap-2"
              style={{
                background: v("bg-2"),
                border: `1px solid ${unassigned ? "rgba(217,119,6,0.45)" : v("line")}`,
              }}
            >
              <span className="min-w-0">
                {pending ? (
                  <span style={{ color: v("muted") }}>Saving…</span>
                ) : row.budget_lines.length === 0 ? (
                  <span style={{ color: v("quiet") }}>This job has no estimate lines yet</span>
                ) : unassigned ? (
                  <span style={{ color: "#FBBF24" }} className="font-medium">
                    Not on a budget line — pick one
                  </span>
                ) : (
                  <>
                    <span
                      className="block text-[10px] uppercase font-semibold"
                      style={{ color: v("quiet"), letterSpacing: "0.14em" }}
                    >
                      Charged to
                    </span>
                    <span className="block truncate font-medium" style={{ color: v("ink") }}>
                      {currentLabel}
                    </span>
                  </>
                )}
              </span>
              {row.budget_lines.length > 0 && !pending && (
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: unassigned ? "#FBBF24" : v("quiet") }}
                >
                  <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            {error && (
              <div className="text-[11px] mt-1" style={{ color: "#F87171" }}>
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      {picking && (
        <LinePicker
          lines={row.budget_lines}
          currentId={lineId}
          vendorLabel={`${row.vendor_name} · ${money(row.amount)}`}
          onPick={pickLine}
          onClose={() => setPicking(false)}
        />
      )}

      {zoom && row.photo_url && (
        <Lightbox
          url={row.photo_url}
          alt={`${row.vendor_name} receipt`}
          onClose={() => setZoom(false)}
        />
      )}
    </div>
  );
}

export function ReceiptTile({
  weekCount = 0,
  flaggedCount = 0,
  compact = false,
}: {
  weekCount?: number;
  flaggedCount?: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ReceiptCaptureRow[] | null>(null);

  const load = useCallback(() => {
    listRecentReceiptCaptures()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    load();
  }, [open, load]);

  const unplaced = (rows ?? []).filter((r) => !r.line_item_id).length;

  return (
    <>
      <Tile
        compact={compact}
        label="Expenses"
        headline={flaggedCount > 0 ? String(flaggedCount) : String(weekCount)}
        sub={flaggedCount > 0 ? "to check" : "this week"}
        tint="#D97706"
        alert={flaggedCount > 0}
        ariaLabel={`Expenses, ${flaggedCount > 0 ? `${flaggedCount} to check` : `${weekCount} this week`}`}
        onClick={() => setOpen(true)}
        icon={
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
            <path d="M5 2.5h10a.5.5 0 0 1 .5.5v14l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-1 .6V3a.5.5 0 0 1 .5-.5z" />
            <path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" strokeLinecap="round" />
          </svg>
        }
      />

      {open && (
        <Sheet
          title="Expenses"
          subtitle={
            rows === null
              ? "Loading…"
              : unplaced > 0
                ? `${unplaced} not on a budget line yet`
                : `${rows.length} captured`
          }
          onClose={() => setOpen(false)}
          footer={
            <Link
              href="/spent"
              onClick={() => setOpen(false)}
              className="block w-full rounded-xl py-2.5 text-center text-[13px] font-medium"
              style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("ink") }}
            >
              Open all spending
            </Link>
          }
        >
          <div className="p-3">
            <BillDrop
              onFiled={() => {
                load();
                router.refresh();
              }}
            />
          </div>

          {rows === null ? (
            <div className="px-4 py-8 text-center text-[13px]" style={{ color: v("quiet") }}>
              Loading expenses…
            </div>
          ) : rows.length === 0 ? (
            <Empty
              line="No expenses captured yet"
              hint="Drop a receipt or bill above and it files itself against the job."
            />
          ) : (
            rows.map((row) => (
              <ReceiptRow
                key={row.id}
                row={row}
                onChanged={() => {
                  load();
                  router.refresh();
                }}
              />
            ))
          )}
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

function DepositRowCard({ row }: { row: DepositRow }) {
  const [zoom, setZoom] = useState(false);
  const alt = `Payment from ${row.payer_name ?? "a client"}`;

  return (
    <div className="px-4 py-3.5" style={{ borderTop: `1px solid ${v("line-soft")}` }}>
      <div className="flex gap-3">
        <Thumb url={row.photo_url} alt={alt} onZoom={() => setZoom(true)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] font-semibold truncate">
              {row.payer_name ?? row.description ?? "Client payment"}
            </span>
            <span
              className="text-[14px] font-semibold shrink-0 tabular-nums"
              style={{ color: "#34d399" }}
            >
              {money(row.amount)}
            </span>
          </div>
          <div className="text-[11.5px] mt-0.5 truncate" style={{ color: v("muted") }}>
            {row.project_label}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: v("quiet") }}>
            {[
              row.payment_type.replace(/_/g, " "),
              row.method,
              row.reference_number ? `#${row.reference_number}` : null,
              fmtDay(row.received_date),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {row.captured_by && (
            <div className="text-[11px] mt-0.5" style={{ color: v("quiet") }}>
              Logged by {firstName(row.captured_by)}
            </div>
          )}
          {row.review_status === "needs_review" && (
            <div className="text-[11px] mt-1" style={{ color: "#FBBF24" }}>
              Needs a look — {row.review_reason}
            </div>
          )}
        </div>
      </div>

      {zoom && row.photo_url && (
        <Lightbox url={row.photo_url} alt={alt} onClose={() => setZoom(false)} />
      )}
    </div>
  );
}

export function DepositTile({
  weekTotal = 0,
  flaggedCount = 0,
  compact = false,
}: {
  weekTotal?: number;
  flaggedCount?: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DepositRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    listRecentDeposits()
      .then(setRows)
      .catch(() => setRows([]));
  }, [open]);

  return (
    <>
      <Tile
        compact={compact}
        label="Deposits"
        headline={flaggedCount > 0 ? String(flaggedCount) : fmtCompact(weekTotal)}
        sub={flaggedCount > 0 ? "to check" : "this week"}
        tint="#10b981"
        alert={flaggedCount > 0}
        ariaLabel={`Deposits, ${flaggedCount > 0 ? `${flaggedCount} to check` : `${fmtCompact(weekTotal)} this week`}`}
        onClick={() => setOpen(true)}
        icon={
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
            <rect x="2" y="5" width="16" height="10" rx="2" />
            <circle cx="10" cy="10" r="2.2" />
            <path d="M5 8.5v3M15 8.5v3" strokeLinecap="round" />
          </svg>
        }
      />

      {open && (
        <Sheet
          title="Deposits"
          subtitle={
            rows === null ? "Loading…" : `${rows.length} most recent payments in`
          }
          onClose={() => setOpen(false)}
          footer={
            <Link
              href="/payments"
              onClick={() => setOpen(false)}
              className="block w-full rounded-xl py-2.5 text-center text-[13px] font-medium"
              style={{ background: v("bg-2"), border: `1px solid ${v("line")}`, color: v("ink") }}
            >
              Open all payments
            </Link>
          }
        >
          <div className="p-3">
            <DepositCapture />
          </div>

          {rows === null ? (
            <div className="px-4 py-8 text-center text-[13px]" style={{ color: v("quiet") }}>
              Loading payments…
            </div>
          ) : rows.length === 0 ? (
            <Empty
              line="No payments recorded yet"
              hint="Photograph a check above and it files against the job."
            />
          ) : (
            rows.map((row) => <DepositRowCard key={row.id} row={row} />)
          )}
        </Sheet>
      )}
    </>
  );
}
