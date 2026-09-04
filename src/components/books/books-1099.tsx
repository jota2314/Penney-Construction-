"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSubTaxInfo } from "@/lib/actions/books";
import type { NineNineRow } from "@/lib/finance/ledger";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

/**
 * Who needs a 1099-NEC in January and whether we have their W-9.
 * Card payments are shown but excluded from the total: the card processor
 * reports those on a 1099-K, not us.
 */
export function Books1099({ rows, year, threshold }: { rows: NineNineRow[]; year: number; threshold: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const need = rows.filter((r) => r.is_1099_eligible && r.paid >= threshold);
  const missingW9 = need.filter((r) => !r.w9_on_file);

  function toggleW9(r: NineNineRow) {
    if (!r.subcontractor_id) return;
    startTransition(async () => {
      const res = await updateSubTaxInfo({ subcontractorId: r.subcontractor_id!, w9_on_file: !r.w9_on_file });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function toggleEligible(r: NineNineRow) {
    if (!r.subcontractor_id) return;
    startTransition(async () => {
      const res = await updateSubTaxInfo({ subcontractorId: r.subcontractor_id!, is_1099_eligible: !r.is_1099_eligible });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Need a 1099 · {year}</div>
          <div className="text-xl font-bold tabular-nums">{need.length}</div>
          <div className="text-[11px] text-muted-foreground">paid ≥ {money(threshold)} by check/ACH</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Missing W-9</div>
          <div className={`text-xl font-bold tabular-nums ${missingW9.length > 0 ? "text-amber-500" : ""}`}>{missingW9.length}</div>
          <div className="text-[11px] text-muted-foreground">Nicole collects these before paying</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total reportable</div>
          <div className="text-xl font-bold tabular-nums">{money(need.reduce((s, r) => s + r.paid, 0))}</div>
          <div className="text-[11px] text-muted-foreground">card payments excluded (1099-K)</div>
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Threshold is {money(threshold)} for {year}{year >= 2026 ? " (raised from $600 for payments made after 2025)" : ""}. Mark a vendor not
        eligible if they are a corporation (LLCs taxed as S/C-corps included); a W-9 tells you which box they checked.
      </p>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_120px_90px_80px_90px_90px] gap-2 px-3 py-2 border-b bg-muted/40 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Vendor</span>
          <span className="text-right">Check / ACH</span>
          <span className="text-right">By card</span>
          <span className="text-center">W-9</span>
          <span className="text-center">Eligible</span>
          <span className="text-right">1099</span>
        </div>
        <div className="divide-y">
          {rows.map((r) => {
            const needs = r.is_1099_eligible && r.paid >= threshold;
            return (
              <div key={`${r.subcontractor_id ?? r.vendor}`} className="px-3 py-2 grid grid-cols-2 sm:grid-cols-[1fr_120px_90px_80px_90px_90px] gap-2 items-center text-[12.5px]">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.vendor}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {r.legal_name ? `${r.legal_name} · ` : ""}
                    {r.payments} payment{r.payments === 1 ? "" : "s"}
                    {r.tax_id_last4 ? ` · TIN ···${r.tax_id_last4}` : ""}
                    {!r.subcontractor_id && " · not in Subcontractors"}
                  </div>
                </div>
                <div className="text-right tabular-nums font-semibold">{money(r.paid)}</div>
                <div className="text-right tabular-nums text-muted-foreground hidden sm:block">{r.paid_by_card ? money(r.paid_by_card) : "—"}</div>
                <div className="text-center">
                  <button
                    onClick={() => toggleW9(r)}
                    disabled={pending || !r.subcontractor_id}
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${r.w9_on_file ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"} disabled:opacity-40`}
                  >
                    {r.w9_on_file ? "On file" : "Missing"}
                  </button>
                </div>
                <div className="text-center hidden sm:block">
                  <button
                    onClick={() => toggleEligible(r)}
                    disabled={pending || !r.subcontractor_id}
                    className="rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    {r.is_1099_eligible ? "Yes" : "No (corp)"}
                  </button>
                </div>
                <div className={`text-right text-[11px] font-semibold ${needs ? "text-amber-500" : "text-muted-foreground"}`}>
                  {needs ? "Required" : r.is_1099_eligible ? "Under" : "Exempt"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
