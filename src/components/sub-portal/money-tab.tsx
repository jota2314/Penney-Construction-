"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import type { BillingRow, JobRollup } from "./types";
import { Card, EmptyState, MONO, Pill, ProgressBar, SectionLabel, StatTile, fmt, fmtDate, fmtShortDate } from "./ui";
import { InvoiceDrop } from "./invoice-drop";

type Filter = "open" | "all";

/**
 * Money: the sub's own bills to Penney, and only those. Awarded vs billed vs
 * paid at the top, every job's balance, then the invoice list.
 */
export function MoneyTab({ allJobs, onOpenJob }: { allJobs: JobRollup[]; onOpenJob: (projectId: string) => void }) {
  const [filter, setFilter] = useState<Filter>("open");

  const awarded = allJobs.reduce((s, j) => s + j.agreed, 0);
  const billed = allJobs.reduce((s, j) => s + j.billing.billed, 0);
  const paid = allJobs.reduce((s, j) => s + j.billing.paid, 0);
  const open = allJobs.reduce((s, j) => s + j.billing.open, 0);

  const nameById = new Map(allJobs.map((j) => [j.proj.id, j.proj.name]));
  const rows: BillingRow[] = allJobs
    .flatMap((j) => j.billing.rows)
    .sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? ""));
  const shown = filter === "open" ? rows.filter((r) => r.open > 0.5) : rows;

  // Jobs with money on them — open balance first, then biggest awarded.
  const withMoney = allJobs
    .filter((j) => j.agreed > 0 || j.billing.billed > 0)
    .sort((a, b) => b.billing.open - a.billing.open || b.agreed - a.agreed);

  const liveJobs = allJobs.filter((j) => j.isLive).map((j) => ({ id: j.proj.id, name: j.proj.name }));

  if (rows.length === 0 && awarded === 0) {
    return (
      <div className="space-y-7">
        <EmptyState icon={Wallet} title="Nothing billed yet" body="Your invoices and payments show up here once the office has them on file." />
        <InvoiceDrop jobs={liveJobs} />
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <InvoiceDrop jobs={liveJobs} />
      <div className="grid grid-cols-2 gap-2.5">
        <StatTile label="Owed to you" value={fmt(open)} tone={open > 0.5 ? "amber" : "emerald"} hint={open > 0.5 ? `${rows.filter((r) => r.open > 0.5).length} open invoice${rows.filter((r) => r.open > 0.5).length === 1 ? "" : "s"}` : "All paid up"} />
        <StatTile label="Paid to you" value={fmt(paid)} tone="emerald" hint={billed > 0 ? `of ${fmt(billed)} billed` : undefined} />
      </div>
      {awarded > 0 && (
        <Card className="px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500" style={MONO}>Awarded work</p>
            <p className="text-[14px] font-semibold text-amber-400" style={MONO}>{fmt(awarded)}</p>
          </div>
          <div className="mt-2.5">
            <ProgressBar value={paid} max={Math.max(awarded, billed)} />
          </div>
          <p className="mt-1.5 text-[11px] text-stone-500" style={MONO}>
            {fmt(paid)} paid · {fmt(Math.max(0, billed - paid))} open · {fmt(Math.max(0, awarded - billed))} not yet billed
          </p>
        </Card>
      )}

      {withMoney.length > 0 && (
        <section>
          <SectionLabel>By job</SectionLabel>
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
            {withMoney.map((j, i) => {
              const total = Math.max(j.agreed, j.billing.billed);
              return (
                <button
                  key={j.proj.id}
                  onClick={() => onOpenJob(j.proj.id)}
                  className={`w-full px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] ${i > 0 ? "border-t border-white/[0.06]" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[14px] font-medium text-stone-100">{j.proj.name}</p>
                    <p className="shrink-0 text-[13px] text-stone-300" style={MONO}>{j.agreed > 0 ? fmt(j.agreed) : fmt(j.billing.billed)}</p>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={j.billing.paid} max={total} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={MONO}>
                    <span className="text-stone-500">Paid <span className="text-emerald-400">{fmt(j.billing.paid)}</span></span>
                    {j.billing.open > 0.5 && <span className="text-amber-400">Open {fmt(j.billing.open)}</span>}
                    {j.agreed > j.billing.billed + 0.5 && (
                      <span className="text-stone-600">{fmt(j.agreed - j.billing.billed)} to bill</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <SectionLabel
          right={
            <div className="flex gap-1">
              {(["open", "all"] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                    filter === f ? "border-amber-500/60 text-amber-400" : "border-white/10 text-stone-500"
                  }`}
                  style={MONO}
                >
                  {f === "open" ? "Open" : "All"}
                </button>
              ))}
            </div>
          }
        >
          Invoices
        </SectionLabel>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-stone-500">
            {filter === "open" ? "No open invoices. You're paid up." : "No invoices on file."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {shown.map((b) => (
              <div key={b.id} className="rounded-xl border border-white/[0.06] px-3.5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[13px] text-stone-200">
                    {b.invoice_number ? `Inv ${b.invoice_number}` : "Invoice"}
                    <span className="ml-2 text-[11px] text-stone-500" style={MONO}>{fmtDate(b.invoice_date)}</span>
                  </p>
                  <p className="shrink-0 text-[13px] text-stone-200" style={MONO}>{fmt(b.amount)}</p>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-stone-500">
                  {nameById.get(b.project_id) ?? "Job"}
                  {b.description ? ` · ${b.description}` : ""}
                </p>
                <div className="mt-1.5">
                  {b.open > 0.5 ? (
                    <Pill tone="amber">Open {fmt(b.open)}{b.paid > 0.5 ? ` · paid ${fmt(b.paid)}` : ""}</Pill>
                  ) : (
                    <Pill tone="emerald">Paid{b.paid_date ? ` ${fmtShortDate(b.paid_date.slice(0, 10))}` : ""}</Pill>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
