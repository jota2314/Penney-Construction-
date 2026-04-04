"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, ScanSearch, Check, AlertTriangle, Plus, X } from "lucide-react";

interface SplitLine {
  line_item_id: string;
  line_description: string;
  amount: number;
  scope_note: string;
  trade: string | null;
  budgeted_cost: number;
}

interface BudgetLine {
  id: string;
  description: string;
  trade: string | null;
  budgeted_cost: number;
}

interface QuoteScanDialogProps {
  quoteId: string;
  projectId: string;
  quoteName: string;
  quoteAmount: number;
  onClose: () => void;
  onComplete: () => void;
}

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

export function QuoteScanDialog({
  quoteId,
  projectId,
  quoteName,
  quoteAmount,
  onClose,
  onComplete,
}: QuoteScanDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splits, setSplits] = useState<SplitLine[]>([]);
  const [allLines, setAllLines] = useState<BudgetLine[]>([]);

  useEffect(() => {
    async function scan() {
      try {
        const res = await fetch("/api/scan-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteId, projectId }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setSplits(data.suggested_splits || []);
          setAllLines(data.line_items || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to scan");
      }
      setLoading(false);
    }
    scan();
  }, [quoteId, projectId]);

  const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
  const remainder = quoteAmount - splitTotal;
  const isBalanced = Math.abs(remainder) < 1;

  function updateAmount(index: number, newAmount: number) {
    setSplits((prev) => prev.map((s, i) => (i === index ? { ...s, amount: newAmount } : s)));
  }

  function updateNote(index: number, note: string) {
    setSplits((prev) => prev.map((s, i) => (i === index ? { ...s, scope_note: note } : s)));
  }

  function removeSplit(index: number) {
    setSplits((prev) => prev.filter((_, i) => i !== index));
  }

  function addSplit(lineId: string) {
    const line = allLines.find((l) => l.id === lineId);
    if (!line || splits.some((s) => s.line_item_id === lineId)) return;
    setSplits((prev) => [
      ...prev,
      {
        line_item_id: lineId,
        line_description: line.description,
        amount: Math.max(0, remainder),
        scope_note: "",
        trade: line.trade,
        budgeted_cost: line.budgeted_cost,
      },
    ]);
  }

  async function handleConfirm() {
    if (!isBalanced) return;
    setSaving(true);
    try {
      const res = await fetch("/api/scan-quote/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId,
          projectId,
          splits: splits.map((s) => ({
            line_item_id: s.line_item_id,
            amount: s.amount,
            line_description: s.line_description,
            scope_note: s.scope_note,
          })),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setSaving(false);
      } else {
        onComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  const availableLines = allLines.filter((l) => !splits.some((s) => s.line_item_id === l.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b">
          <div className="flex items-center gap-2 mb-1">
            <ScanSearch className="h-4 w-4 text-purple-500" />
            <h2 className="text-sm font-semibold">Scan & Link to Estimate</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {quoteName} — {fmt(quoteAmount)}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              AI is reading the quote and matching to estimate lines...
            </div>
          ) : error ? (
            <div className="text-sm text-red-400 text-center py-8">{error}</div>
          ) : (
            <>
              {/* Splits */}
              <div className="space-y-2">
                {splits.map((split, i) => (
                  <div key={split.line_item_id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{split.line_description}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {split.trade} — Budget: {fmt(split.budgeted_cost)}
                        </div>
                      </div>
                      <button onClick={() => removeSplit(i)} className="text-muted-foreground hover:text-red-400 p-1">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">$</span>
                      <input
                        type="number"
                        value={split.amount}
                        onChange={(e) => updateAmount(i, Number(e.target.value) || 0)}
                        className="flex-1 bg-background border rounded px-2 py-1 text-sm font-medium tabular-nums"
                        step="100"
                      />
                      {split.budgeted_cost > 0 && (
                        <span className={`text-[10px] font-medium ${split.amount <= split.budgeted_cost ? "text-green-500" : "text-red-400"}`}>
                          {split.amount <= split.budgeted_cost
                            ? `${fmt(split.budgeted_cost - split.amount)} under`
                            : `${fmt(split.amount - split.budgeted_cost)} over`}
                        </span>
                      )}
                    </div>

                    <input
                      type="text"
                      value={split.scope_note}
                      onChange={(e) => updateNote(i, e.target.value)}
                      placeholder="Scope note (what this covers)"
                      className="w-full bg-background border rounded px-2 py-1 text-xs text-muted-foreground"
                    />
                  </div>
                ))}
              </div>

              {/* Add line dropdown */}
              {availableLines.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1">
                    <Plus className="h-3 w-3" /> Add estimate line
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {availableLines.map((line) => (
                      <button
                        key={line.id}
                        onClick={() => addSplit(line.id)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-muted/10 border border-dashed border-border/50 hover:border-primary/50 hover:bg-muted/30 transition-colors text-left"
                      >
                        <div>
                          <div className="text-xs font-medium">{line.description}</div>
                          <div className="text-[10px] text-muted-foreground">{line.trade}</div>
                        </div>
                        <div className="text-xs text-muted-foreground">{fmt(line.budgeted_cost)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Balance */}
              <div className={`rounded-lg p-3 text-center text-sm font-medium ${
                isBalanced
                  ? "bg-green-500/10 text-green-500 border border-green-500/20"
                  : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
              }`}>
                {isBalanced ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <Check className="h-4 w-4" />
                    Balanced — {fmt(splitTotal)}
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    {fmt(splitTotal)} of {fmt(quoteAmount)} — {fmt(Math.abs(remainder))} {remainder > 0 ? "remaining" : "over"}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!isBalanced || loading || saving || splits.length === 0}
            onClick={handleConfirm}
            className="gap-1.5"
          >
            {saving ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</>
            ) : splits.length === 1 ? (
              <><Check className="h-3 w-3" /> Link to Estimate Line</>
            ) : (
              <><Check className="h-3 w-3" /> Split into {splits.length} Quotes</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
