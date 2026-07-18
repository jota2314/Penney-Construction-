"use client";

import { CircleCheck, FileText, ScrollText, TriangleAlert } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  PaymentScheduleCard,
  type LinkedInvoiceLite,
  type PaymentMilestoneRow,
} from "@/components/projects/payment-schedule-card";

interface ContractBuilderProps {
  projectId: string;
  projectName: string;
  projectNumber: string;
  clientName: string;
  projectAddress: string;
  basis: number;
  basisSource: string;
  hasEstimate: boolean;
  milestones: PaymentMilestoneRow[];
  clientInvoices: LinkedInvoiceLite[];
}

// The contract flow, in order: 1) check the contract facts, 2) set the
// payment schedule, 3) generate the branded PDF. The schedule lives on
// project_payment_milestones — the same rows the Finances tab invoices from.
export function ContractBuilder({
  projectId,
  projectName,
  projectNumber,
  clientName,
  projectAddress,
  basis,
  basisSource,
  hasEstimate,
  milestones,
  clientInvoices,
}: ContractBuilderProps) {
  const scheduleReady = milestones.length >= 2;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* ── Step 1: the contract facts ── */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
              <ScrollText className="h-5 w-5 text-amber-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Construction Contract</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {projectNumber} · everything below flows straight into the PDF.
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-xs font-medium text-muted-foreground">Client</dt>
              <dd className="font-medium">{clientName || "— no customer on the project —"}</dd>
            </div>
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-xs font-medium text-muted-foreground">Project address</dt>
              <dd className="font-medium">{projectAddress || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-xs font-medium text-muted-foreground">Contract price</dt>
              <dd className="font-semibold">
                {basis > 0 ? formatCurrency(basis) : "—"}
                <span className="ml-1 text-xs font-normal text-muted-foreground">({basisSource})</span>
              </dd>
            </div>
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-xs font-medium text-muted-foreground">Scope (Exhibit A)</dt>
              <dd className="font-medium">
                {hasEstimate ? "From the latest estimate's line items" : "No estimate yet"}
              </dd>
            </div>
          </dl>

          {!hasEstimate && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-500">
              <TriangleAlert className="h-3.5 w-3.5" />
              The contract needs an estimate for the scope and price — build one first.
            </p>
          )}
        </div>
      </section>

      {/* ── Step 2: generate the contract ── */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Generate the contract</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {scheduleReady
                ? "Branded PDF with your payment milestones, Exhibit A scope, and MA terms (3-day right to cancel, 1/3 deposit cap)."
                : "Branded PDF with the standard thirds payment split, Exhibit A scope, and MA terms (3-day right to cancel, 1/3 deposit cap)."}
            </p>
          </div>
          <a
            href={`/api/generate-contract?projectId=${projectId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-amber-400"
          >
            {scheduleReady ? <CircleCheck className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            Contract PDF
          </a>
        </div>
      </section>

      {/* ── Step 3: payment schedule (after the contract) ── */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="p-4">
          <PaymentScheduleCard
            projectId={projectId}
            milestones={milestones}
            clientInvoices={clientInvoices}
            contractBasis={basis}
            showContractButton={false}
          />
          <p className="px-1 text-[11px] text-muted-foreground">
            Do this after the contract: set the milestones you agreed to (or let AI draft them) and each
            becomes a one-click client invoice on the Finances tab as the job hits it. If you change the
            split before signing, just regenerate the contract above.
          </p>
        </div>
      </section>
    </div>
  );
}
