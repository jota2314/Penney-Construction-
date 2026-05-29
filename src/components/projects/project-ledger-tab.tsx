"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Wallet,
  ExternalLink,
  FileSpreadsheet,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getProjectLedger, syncProjectLedger } from "@/lib/actions/job-ledger";
import type { LedgerEntry, LedgerSummary } from "@/lib/ledger/parse";

interface ProjectLedgerTabProps {
  projectId: string;
  contractValue: number | null;
}

export function ProjectLedgerTab({
  projectId,
  contractValue,
}: ProjectLedgerTabProps) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [ledgerUrl, setLedgerUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getProjectLedger(projectId);
    setSummary(res.summary);
    setEntries(res.entries);
    setLedgerUrl(res.ledgerUrl);
    setLoading(false);
  }, [projectId]);

  // Load on mount; auto-sync once if nothing has been pulled yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getProjectLedger(projectId);
      if (cancelled) return;
      setSummary(res.summary);
      setEntries(res.entries);
      setLedgerUrl(res.ledgerUrl);
      setLoading(false);
      if (!res.entries.length) {
        void sync();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    const res = await syncProjectLedger(projectId);
    if (res.error) {
      setError(res.error);
    } else {
      await load();
    }
    setSyncing(false);
  }, [projectId, load]);

  const billedPct =
    contractValue && summary
      ? Math.round((summary.total_deposits / contractValue) * 100)
      : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Job Ledger</h3>
          <p className="text-sm text-muted-foreground">
            Live money in &amp; out, synced from the Drive ledger sheet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ledgerUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={ledgerUrl} target="_blank" rel="noopener noreferrer">
                <FileSpreadsheet className="h-4 w-4" />
                Open sheet
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          <Button size="sm" onClick={sync} disabled={syncing}>
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {syncing ? "Syncing…" : "Sync"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            Money in (deposits)
          </div>
          <div className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(summary?.total_deposits ?? 0)}
          </div>
          {billedPct != null && (
            <div className="mt-1 text-xs text-muted-foreground">
              {billedPct}% of {formatCurrency(contractValue)} contract
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingDown className="h-4 w-4 text-rose-500" />
            Money out (spent)
          </div>
          <div className="mt-1 text-2xl font-semibold text-rose-600 dark:text-rose-400">
            {formatCurrency(summary?.total_expenses ?? 0)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="h-4 w-4 text-amber-500" />
            Cash on hand
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {formatCurrency(summary?.cash_balance ?? 0)}
          </div>
          {summary?.last_entry_date && (
            <div className="mt-1 text-xs text-muted-foreground">
              Last entry {formatDate(summary.last_entry_date)}
            </div>
          )}
        </Card>
      </div>

      {/* Entries */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading ledger…
        </div>
      ) : entries.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No ledger entries yet. Click <strong>Sync</strong> to pull from the
          Drive ledger sheet, or make sure a “{""}
          <span className="font-medium">Ledger</span>” sheet exists for this job.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-border/50">
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {e.entry_date ? formatDate(e.entry_date) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span>{e.description || "—"}</span>
                      {e.direction === "deposit" && (
                        <Badge variant="outline" className="ml-2 text-emerald-600">
                          deposit
                        </Badge>
                      )}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums ${
                        e.amount >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {formatCurrency(e.amount, "two")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
