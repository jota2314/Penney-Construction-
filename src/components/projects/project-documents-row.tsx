"use client";

import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  ExternalLink,
  FileText,
  Ruler,
} from "lucide-react";
import type { ContractState } from "./payment-schedule-card";
import type { Estimate } from "@/types/database";

export interface TakeoffSummary {
  measurementCount: number;
  sheetCount: number;
  tradeCount: number;
}

interface ProjectDocumentsRowProps {
  projectId: string;
  estimates: Estimate[];
  contract?: ContractState;
  takeoff?: TakeoffSummary;
  /** Carries the current tab + filters so the back link lands where you left. */
  returnUrl: string;
}

const fmtMoney = (val: number | null | undefined) =>
  val != null
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(val)
    : null;

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

/** Where the contract actually stands, in the order that matters to Jorge. */
function contractStatus(contract?: ContractState): {
  label: string;
  tone: "done" | "live" | "idle";
  detail: string | null;
} {
  if (!contract) return { label: "Not started", tone: "idle", detail: null };
  if (contract.countersignedAt) {
    return {
      label: "Signed",
      tone: "done",
      detail: [fmtMoney(contract.lockedAmount), fmtDate(contract.countersignedAt)]
        .filter(Boolean)
        .join(" · ") || null,
    };
  }
  if (contract.clientSignedAt) {
    return {
      label: "Needs countersign",
      tone: "live",
      detail: `Client signed ${fmtDate(contract.clientSignedAt)}`,
    };
  }
  if (contract.sentAt) {
    return {
      label: "Out for signature",
      tone: "live",
      detail: contract.viewedAt
        ? `Viewed ${fmtDate(contract.viewedAt)}`
        : `Sent ${fmtDate(contract.sentAt)}`,
    };
  }
  return { label: "Not sent", tone: "idle", detail: "Opens the current draft" };
}

const TONE_CLASS: Record<"done" | "live" | "idle", string> = {
  done: "bg-emerald-500/15 text-emerald-500",
  live: "bg-amber-500/15 text-amber-500",
  idle: "bg-muted text-muted-foreground",
};

/**
 * Contract, accepted estimate, and takeoff — the three documents that answer
 * "what did we agree to build, and how did we measure it." Everything else
 * lives behind a tab.
 */
export function ProjectDocumentsRow({
  projectId,
  estimates,
  contract,
  takeoff,
  returnUrl,
}: ProjectDocumentsRowProps) {
  const status = contractStatus(contract);

  // The stamped contract estimate wins over version order — on a multi-option
  // job the highest version is the option, not the deal. See the estimate
  // status trap in the contract work.
  const accepted =
    (contract?.estimateId
      ? estimates.find((e) => e.id === contract.estimateId)
      : undefined) ??
    estimates.find((e) => e.status === "approved") ??
    null;

  const cardClass =
    "flex flex-col rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:border-amber-500/40";
  const linkClass =
    "mt-auto inline-flex items-center gap-1.5 pt-3 text-xs font-medium text-amber-500";

  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {/* ── Contract ── */}
      <a
        href={`/api/generate-contract?projectId=${projectId}`}
        target="_blank"
        rel="noopener noreferrer"
        className={cardClass}
      >
        <div className="flex items-center justify-between">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
            <FileText className="h-4 w-4" />
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE_CLASS[status.tone]}`}
          >
            {status.label}
          </span>
        </div>
        <div className="mt-2.5 text-sm font-semibold">Contract</div>
        <div className="text-xs text-muted-foreground">
          {status.detail ?? "Generated live from the pinned estimate"}
        </div>
        <span className={linkClass}>
          Open PDF
          <ExternalLink className="h-3.5 w-3.5" />
        </span>
      </a>

      {/* ── Accepted estimate ── */}
      {accepted ? (
        <Link
          href={`/projects/${projectId}/estimates/${accepted.id}?returnUrl=${returnUrl}`}
          className={cardClass}
        >
          <div className="flex items-center justify-between">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
              <Calculator className="h-4 w-4" />
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                accepted.status === "approved"
                  ? TONE_CLASS.done
                  : TONE_CLASS.idle
              }`}
            >
              {contract?.estimateId === accepted.id ? "On contract" : accepted.status}
            </span>
          </div>
          <div className="mt-2.5 text-sm font-semibold">Accepted estimate</div>
          <div className="text-xs text-muted-foreground">
            v{accepted.version} · {fmtMoney(accepted.total_price)}
          </div>
          <span className={linkClass}>
            Open estimate
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      ) : (
        <Link
          href={`/projects/${projectId}/estimates?returnUrl=${returnUrl}`}
          className={cardClass}
        >
          <div className="flex items-center justify-between">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
              <Calculator className="h-4 w-4" />
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE_CLASS.idle}`}>
              {estimates.length > 0 ? "None approved" : "None yet"}
            </span>
          </div>
          <div className="mt-2.5 text-sm font-semibold">Accepted estimate</div>
          <div className="text-xs text-muted-foreground">
            {estimates.length > 0
              ? `${estimates.length} ${estimates.length === 1 ? "version" : "versions"}, none approved`
              : "No estimate built yet"}
          </div>
          <span className={linkClass}>
            {estimates.length > 0 ? "Open estimates" : "Build one"}
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}

      {/* ── Takeoff ── measuring needs a sheet, so this lands on the picker. */}
      <Link
        href={`/projects/${projectId}/estimates/drawings?returnUrl=${returnUrl}`}
        className={cardClass}
      >
        <div className="flex items-center justify-between">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500">
            <Ruler className="h-4 w-4" />
          </span>
          {takeoff && takeoff.sheetCount > 0 && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE_CLASS.idle}`}>
              {takeoff.sheetCount} {takeoff.sheetCount === 1 ? "sheet" : "sheets"}
            </span>
          )}
        </div>
        <div className="mt-2.5 text-sm font-semibold">Takeoff</div>
        <div className="text-xs text-muted-foreground">
          {takeoff && takeoff.measurementCount > 0
            ? `${takeoff.measurementCount} measurements · ${takeoff.tradeCount} ${
                takeoff.tradeCount === 1 ? "trade" : "trades"
              }`
            : "Nothing measured yet"}
        </div>
        <span className={linkClass}>
          Open drawings
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </Link>
    </div>
  );
}
