"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Lock, LockOpen, Plus, Receipt, Send, Sparkles, Trash2, TriangleAlert } from "lucide-react";
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
  countersignContract,
  markContractSignedOnPaper,
  seedDefaultPaymentSchedule,
  unlockContract,
} from "@/lib/actions/contract-signing";
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

/** Signing + lock state for the project's contract (columns on `projects`). */
export interface ContractState {
  status: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  viewCount: number | null;
  clientSignature: string | null;
  clientSignedAt: string | null;
  countersignedName: string | null;
  countersignedAt: string | null;
  lockedAmount: number | null;
  lockedAt: string | null;
  signedPdfPath: string | null;
  /** Owners + precon only — countersigning binds the company to a price. */
  canCountersign: boolean;
}

interface PaymentScheduleCardProps {
  projectId: string;
  milestones: PaymentMilestoneRow[];
  /** Client invoices on this project — used to show live status on linked milestones. */
  clientInvoices: LinkedInvoiceLite[];
  /** Contract value (falls back to latest estimate / estimated value upstream). */
  contractBasis: number;
  /** Hidden on the contract page itself (which has its own generate button). */
  showContractButton?: boolean;
  contract?: ContractState;
}

// Rendered INSIDE the "Client Invoices" section on the Finances tab so the
// schedule and its invoices read as one combined flow: set milestones →
// one-click invoice each as the job hits that stage.
export function PaymentScheduleCard({ projectId, milestones, clientInvoices, contractBasis, showContractButton = true, contract }: PaymentScheduleCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [presetKey, setPresetKey] = useState(PAYMENT_PRESETS[0].key);
  const [aiBusy, setAiBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);

  const locked = !!contract?.lockedAt;
  const clientSigned = !!contract?.clientSignedAt;
  // A locked schedule is a signed schedule. Editing it would put the app out
  // of step with the document both parties put their name on.
  const frozen = locked;

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

  // Emails the client the contract PDF + a /contract/[token] signing link.
  // The route saves the thirds schedule first when there is none, so the PDF
  // can no longer print a payment schedule the app has no record of.
  const onSendForSignature = async (testOnly: boolean) => {
    if (
      !testOnly &&
      !confirm(
        `Email the contract to the client for online signature at ${formatCurrency(contractBasis)}?\n\nRyan is CC'd. The price locks once he countersigns.`,
      )
    )
      return;
    setSendBusy(true);
    try {
      const res = await fetch("/api/send-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, testOnly }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      alert(json.message);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSendBusy(false);
    }
  };

  const onCountersign = () => {
    const name = prompt(
      `Countersign for Penney Construction, Inc.\n\nThis locks the contract at ${formatCurrency(contractBasis)}, freezes the payment schedule into fixed dollar amounts, and premakes a draft invoice for every milestone.\n\nType your full name to sign:`,
    );
    if (!name?.trim()) return;
    startTransition(async () => {
      const result = await countersignContract(projectId, name.trim());
      if (result.error) alert(result.error);
      else if (result.data) {
        alert(
          `Contract locked at ${formatCurrency(result.data.lockedAmount)}.\n` +
            `${result.data.invoicesCreated} invoice(s) premade` +
            (result.data.paymentsMatched > 0
              ? `, ${result.data.paymentsMatched} matched against payments already received.`
              : "."),
        );
      }
      router.refresh();
    });
  };

  // Jobs signed on paper before this flow existed still need the lock and the
  // premade invoices — otherwise their Contract tile stays empty forever.
  const onMarkSignedOnPaper = () => {
    const name = prompt("Name of the client who signed the paper contract:");
    if (!name?.trim()) return;
    const date = prompt("Date signed (YYYY-MM-DD). Leave blank for today:") || undefined;
    startTransition(async () => {
      const result = await markContractSignedOnPaper(projectId, name.trim(), date);
      if (result.error) alert(result.error);
      else if (result.data) {
        alert(
          `Contract locked at ${formatCurrency(result.data.lockedAmount)}.\n` +
            `${result.data.invoicesCreated} invoice(s) premade` +
            (result.data.paymentsMatched > 0
              ? `, ${result.data.paymentsMatched} matched against payments already received.`
              : "."),
        );
      }
      router.refresh();
    });
  };

  const onUnlock = () => {
    if (!confirm("Unlock this contract? The price goes back to tracking the live estimate.")) return;
    run(() => unlockContract(projectId).then((r) => ({ error: r.error ?? null })));
  };

  return (
    <div className="mb-4 rounded-xl bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">Payment Schedule</h4>
        <span className="text-[11px] text-muted-foreground">
          milestones → one-click invoices
          {contractBasis > 0 && (
            <>
              {" "}· {locked ? "locked at" : "basis"} {formatCurrency(contractBasis)}
            </>
          )}
        </span>
      </div>

      {/* ── Signing status ── */}
      {contract && (locked || clientSigned || contract.sentAt) && (
        <div
          className={`mt-2.5 rounded-xl border px-3 py-2.5 text-xs ${
            locked
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-blue-500/30 bg-blue-500/10"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {locked ? (
              <Lock className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Send className="h-3.5 w-3.5 text-blue-500" />
            )}
            <span className={`font-semibold ${locked ? "text-emerald-500" : "text-blue-500"}`}>
              {locked
                ? "Fully executed — contract price locked"
                : clientSigned
                  ? "Client signed — waiting on countersignature"
                  : contract.viewedAt
                    ? "Sent · client viewed it"
                    : "Sent — waiting on the client"}
            </span>
            {contract.viewCount && contract.viewCount > 1 ? (
              <span className="text-muted-foreground">viewed {contract.viewCount}×</span>
            ) : null}
          </div>
          <div className="mt-1.5 space-y-0.5 text-muted-foreground">
            {contract.clientSignature && (
              <div>
                Client: <span className="font-medium text-foreground">{contract.clientSignature}</span>
                {contract.clientSignedAt && ` · ${new Date(contract.clientSignedAt).toLocaleDateString()}`}
              </div>
            )}
            {contract.countersignedAt && (
              <div>
                Penney: <span className="font-medium text-foreground">{contract.countersignedName || "Penney Construction, Inc."}</span>
                {` · ${new Date(contract.countersignedAt).toLocaleDateString()}`}
              </div>
            )}
            {locked && (
              <div className="pt-0.5">
                Estimate edits no longer move this number — price changes go through a change order.
              </div>
            )}
          </div>

          {clientSigned && !locked && contract.canCountersign && (
            <button
              onClick={onCountersign}
              disabled={isPending}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
            >
              <Lock className="h-3.5 w-3.5" />
              Countersign &amp; lock
            </button>
          )}
          {locked && contract.canCountersign && (
            <button
              onClick={onUnlock}
              disabled={isPending}
              className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              <LockOpen className="h-3 w-3" />
              Unlock
            </button>
          )}
        </div>
      )}

      {/* One tap, no page-hopping: the contract generates right here.
          Prints the milestones below, or the standard thirds split if none. */}
      {showContractButton && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <a
            href={`/api/generate-contract?projectId=${projectId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-black hover:bg-amber-400"
          >
            <FileText className="h-4 w-4" />
            Contract PDF
          </a>
          {!clientSigned && (
            <button
              onClick={() => onSendForSignature(false)}
              disabled={sendBusy || contractBasis <= 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-500 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {sendBusy ? "Sending…" : "Send for signature"}
            </button>
          )}
        </div>
      )}

      {showContractButton && !locked && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          {!clientSigned && (
            <button
              onClick={() => onSendForSignature(true)}
              disabled={sendBusy}
              className="h-7 rounded-lg border px-2 font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Test send to me
            </button>
          )}
          {contract?.canCountersign && (
            <button
              onClick={onMarkSignedOnPaper}
              disabled={isPending}
              className="h-7 rounded-lg border px-2 font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Already signed on paper
            </button>
          )}
        </div>
      )}

      {/* Preset picker — hidden once signed; the schedule is the contract now. */}
      <div className={`mt-2.5 flex flex-wrap items-center gap-2 ${frozen ? "hidden" : ""}`}>
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
        <div className="mt-3 rounded-xl border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No payment schedule saved. The contract PDF prints a thirds split by default — save it here so each
            payment becomes a one-click client invoice.
          </p>
          <button
            onClick={() => run(() => seedDefaultPaymentSchedule(projectId).then((r) => ({ error: r.error ?? null })))}
            disabled={isPending}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Use the standard thirds schedule
          </button>
        </div>
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
              frozen={frozen}
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
  frozen,
  onChange,
  onInvoice,
  onDelete,
}: {
  index: number;
  milestone: PaymentMilestoneRow;
  linkedInvoice: LinkedInvoiceLite | null;
  computedDollars: number;
  disabled: boolean;
  /** Contract is signed — the schedule is part of an executed document. */
  frozen: boolean;
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
          disabled={disabled || frozen}
          className="min-w-40 flex-1 rounded-lg border bg-background px-2 py-1.5 text-xs"
          placeholder="Milestone description (appears on the contract + invoice)"
        />
        <span className="ml-auto text-xs font-semibold tabular-nums">{formatCurrency(computedDollars)}</span>
        <button
          onClick={onDelete}
          disabled={disabled || frozen || invoiced}
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
          disabled={disabled || frozen}
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
            disabled={disabled || frozen}
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
            disabled={disabled || frozen}
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
