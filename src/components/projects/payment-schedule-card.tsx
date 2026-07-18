"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Receipt, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  addPaymentMilestone,
  applyPaymentPreset,
  deletePaymentMilestone,
  invoiceMilestone,
  replaceSchedule,
  updatePaymentMilestone,
} from "@/lib/actions/payment-schedule";
import {
  MA_DEPOSIT_CAP_PCT,
  PAYMENT_PRESETS,
  PAYMENT_STAGE_OPTIONS,
} from "@/lib/constants/payment-schedule";

export interface PaymentMilestoneRow {
  id: string;
  sort_order: number;
  label: string;
  stage_key: string;
  percent: number | null;
  amount: number | null;
  status: string;
  client_invoice_id: string | null;
}

export interface LinkedInvoiceLite {
  id: string;
  invoice_number: number;
  status: string;
  paid_at: string | null;
}

interface PaymentScheduleCardProps {
  projectId: string;
  milestones: PaymentMilestoneRow[];
  /** Client invoices on this project — used to show live status on linked milestones. */
  clientInvoices: LinkedInvoiceLite[];
  /** Contract value (falls back to latest estimate / estimated value upstream). */
  contractBasis: number;
}

// Rendered INSIDE the "Client Invoices" section on the Finances tab so the
// schedule and its invoices read as one combined flow: set milestones →
// one-click invoice each as the job hits that stage.
export function PaymentScheduleCard({ projectId, milestones, clientInvoices, contractBasis }: PaymentScheduleCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [presetKey, setPresetKey] = useState(PAYMENT_PRESETS[0].key);
  const [aiBusy, setAiBusy] = useState(false);

  const rows = useMemo(
    () => [...milestones].sort((a, b) => a.sort_order - b.sort_order),
    [milestones]
  );

  const dollars = (m: PaymentMilestoneRow): number =>
    m.amount != null && !Number.isNaN(Number(m.amount))
      ? Number(m.amount)
      : contractBasis > 0 && m.percent != null
        ? (contractBasis * Number(m.percent)) / 100
        : 0;

  const totalDollars = rows.reduce((s, m) => s + dollars(m), 0);
  const totalPercent = rows.reduce((s, m) => s + (m.percent != null ? Number(m.percent) : 0), 0);
  const allPercentDriven = rows.length > 0 && rows.every((m) => m.percent != null);
  const percentOff = allPercentDriven && Math.abs(totalPercent - 100) > 0.05;

  const depositRow = rows.find((m) => m.stage_key === "deposit") ?? rows[0];
  const depositPct = depositRow && contractBasis > 0 ? (dollars(depositRow) / contractBasis) * 100 : 0;
  const depositOverCap = depositPct > MA_DEPOSIT_CAP_PCT;

  const run = (fn: () => Promise<{ error: string | null }>) => {
    startTransition(async () => {
      const { error } = await fn();
      if (error) alert(error);
      router.refresh();
    });
  };

  const onApplyPreset = () => {
    const preset = PAYMENT_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    if (
      rows.length > 0 &&
      !confirm(`Replace the current ${rows.length}-milestone schedule with "${preset.name}"?`)
    )
      return;
    run(() => applyPaymentPreset(projectId, presetKey));
  };

  // AI drafts a job-specific schedule from the scope, estimate sections, and
  // schedule phases — shown for approval before it replaces anything.
  const onAiSuggest = async () => {
    setAiBusy(true);
    try {
      const res = await fetch("/api/suggest-payment-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      const suggested: { label: string; stage_key: string; percent: number }[] = json.rows;
      const preview = suggested
        .map((r, i) => `${i + 1}. ${r.label} — ${r.percent}%${contractBasis > 0 ? ` (${formatCurrency((contractBasis * r.percent) / 100)})` : ""}`)
        .join("\n");
      if (!confirm(`AI suggests this schedule for the job:\n\n${preview}\n\nApply it?${rows.length > 0 ? " (replaces the current schedule)" : ""}`)) return;
      run(() => replaceSchedule(projectId, suggested));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">Payment Schedule</h4>
        <span className="text-[11px] text-muted-foreground">
          milestones → one-click invoices
          {contractBasis > 0 && <> · basis {formatCurrency(contractBasis)}</>}
        </span>
        <a
          href={`/api/generate-contract?projectId=${projectId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <FileText className="h-3.5 w-3.5" />
          Contract PDF
        </a>
      </div>

      {/* Preset picker */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <select
          value={presetKey}
          onChange={(e) => setPresetKey(e.target.value)}
          className="h-8 rounded-lg border bg-background px-2 text-xs"
        >
          {PAYMENT_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={onApplyPreset}
          disabled={isPending}
          className="h-8 rounded-lg border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Apply preset
        </button>
        <button
          onClick={onAiSuggest}
          disabled={isPending || aiBusy}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 text-xs font-semibold text-amber-500 hover:bg-amber-500/25 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {aiBusy ? "Thinking…" : "AI schedule"}
        </button>
        <button
          onClick={() => run(() => addPaymentMilestone(projectId, { label: "New milestone", stage_key: "custom" }))}
          disabled={isPending}
          className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add milestone
        </button>
        <span className="text-[11px] text-muted-foreground">
          {PAYMENT_PRESETS.find((p) => p.key === presetKey)?.description}
        </span>
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
          No payment schedule yet — apply a preset above (deposit / rough inspection / final, and more) or add
          milestones one by one. Each milestone becomes a one-click client invoice.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((m, i) => (
            <MilestoneRow
              key={m.id}
              index={i}
              milestone={m}
              linkedInvoice={clientInvoices.find((ci) => ci.id === m.client_invoice_id) ?? null}
              computedDollars={dollars(m)}
              disabled={isPending}
              onChange={(patch) => run(() => updatePaymentMilestone(m.id, projectId, patch))}
              onInvoice={() => {
                if (
                  confirm(
                    `Create a client invoice for "${m.label}" at ${formatCurrency(dollars(m))}? It will appear below as a draft you can send.`
                  )
                )
                  run(() => invoiceMilestone(projectId, m.id));
              }}
              onDelete={() => {
                if (confirm(`Delete "${m.label}"?`)) run(() => deletePaymentMilestone(m.id, projectId));
              }}
            />
          ))}

          {/* Totals + compliance */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background/60 px-3 py-2 text-xs">
            <span className="font-semibold">
              Total {formatCurrency(totalDollars)}
              {allPercentDriven && <span className="ml-1 text-muted-foreground">({totalPercent.toFixed(1)}%)</span>}
            </span>
            {percentOff && (
              <span className="inline-flex items-center gap-1 text-amber-500">
                <TriangleAlert className="h-3.5 w-3.5" />
                Percentages should add up to 100%
              </span>
            )}
            {depositOverCap && (
              <span className="inline-flex items-center gap-1 text-amber-500">
                <TriangleAlert className="h-3.5 w-3.5" />
                MA c.142A caps the deposit at 1/3 of the contract price
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MilestoneRow({
  index,
  milestone,
  linkedInvoice,
  computedDollars,
  disabled,
  onChange,
  onInvoice,
  onDelete,
}: {
  index: number;
  milestone: PaymentMilestoneRow;
  linkedInvoice: LinkedInvoiceLite | null;
  computedDollars: number;
  disabled: boolean;
  onChange: (patch: { label?: string; stage_key?: string; percent?: number | null; amount?: number | null; status?: string }) => void;
  onInvoice: () => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(milestone.label);
  const [percent, setPercent] = useState(milestone.percent != null ? String(milestone.percent) : "");
  const [amount, setAmount] = useState(milestone.amount != null ? String(milestone.amount) : "");

  const paid = linkedInvoice ? linkedInvoice.status === "paid" || !!linkedInvoice.paid_at : milestone.status === "paid";
  const invoiced = !!linkedInvoice || milestone.status === "invoiced";

  const commitLabel = () => {
    const v = label.trim();
    if (v && v !== milestone.label) onChange({ label: v });
  };

  const commitPercent = () => {
    const v = percent.trim() === "" ? null : Number(percent);
    if (v !== null && (Number.isNaN(v) || v < 0 || v > 100))
      return setPercent(milestone.percent != null ? String(milestone.percent) : "");
    if (v !== (milestone.percent != null ? Number(milestone.percent) : null)) {
      // Percent-driven rows drop any fixed amount.
      onChange({ percent: v, amount: v !== null ? null : milestone.amount });
      if (v !== null) setAmount("");
    }
  };

  const commitAmount = () => {
    const v = amount.trim() === "" ? null : Number(amount);
    if (v !== null && (Number.isNaN(v) || v < 0))
      return setAmount(milestone.amount != null ? String(milestone.amount) : "");
    if (v !== (milestone.amount != null ? Number(milestone.amount) : null)) {
      // Fixed-amount rows drop the percent.
      onChange({ amount: v, percent: v !== null ? null : milestone.percent });
      if (v !== null) setPercent("");
    }
  };

  return (
    <div className="rounded-xl border bg-background p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
          {index + 1}
        </span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          disabled={disabled}
          className="min-w-40 flex-1 rounded-lg border bg-background px-2 py-1.5 text-xs"
          placeholder="Milestone description (appears on the contract + invoice)"
        />
        <span className="ml-auto text-xs font-semibold tabular-nums">{formatCurrency(computedDollars)}</span>
        <button
          onClick={onDelete}
          disabled={disabled || invoiced}
          title={invoiced ? "Unlink not supported — delete the invoice first" : "Delete milestone"}
          className="flex h-7 w-7 items-center justify-center self-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          aria-label="Delete milestone"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
        <select
          value={milestone.stage_key}
          onChange={(e) => onChange({ stage_key: e.target.value })}
          disabled={disabled}
          className="h-7 rounded-lg border bg-background px-1.5 text-[11px]"
        >
          {PAYMENT_STAGE_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          %
          <input
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            onBlur={commitPercent}
            disabled={disabled}
            inputMode="decimal"
            className="w-14 rounded-lg border bg-background px-1.5 py-1 text-right text-[11px] tabular-nums"
            placeholder="—"
          />
        </label>
        <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          $
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={commitAmount}
            disabled={disabled}
            inputMode="decimal"
            className="w-20 rounded-lg border bg-background px-1.5 py-1 text-right text-[11px] tabular-nums"
            placeholder="fixed"
          />
        </label>

        {invoiced ? (
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
              paid ? "bg-emerald-500/15 text-emerald-500" : "bg-blue-500/15 text-blue-500"
            }`}
          >
            <Receipt className="h-3 w-3" />
            {linkedInvoice ? `Invoice #${linkedInvoice.invoice_number}` : "Invoiced"}
            {paid ? " · paid" : ""}
          </span>
        ) : (
          <button
            onClick={onInvoice}
            disabled={disabled || computedDollars <= 0}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-500 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            <Receipt className="h-3.5 w-3.5" />
            Create invoice
          </button>
        )}
      </div>
    </div>
  );
}
