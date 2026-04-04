"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Split, Check, AlertTriangle } from "lucide-react";

interface SplitLine {
  line_item_id: string;
  description: string;
  amount: number;
  reason: string;
  trade: string | null;
  budgeted_cost: number;
}

interface BudgetLine {
  id: string;
  description: string;
  trade: string | null;
  budgeted_cost: number;
}

interface QuoteSplitDialogProps {
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

export function QuoteSplitDialog({
  quoteId,
  projectId,
  quoteName,
  quoteAmount,
  onClose,
  onComplete,
}: QuoteSplitDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splits, setSplits] = useState<SplitLine[]>([]);
  const [allLines, setAllLines] = useState<BudgetLine[]>([]);

  // Load AI suggestion
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/split-quote", {
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
        setError(err instanceof Error ? err.message : "Failed to load");
      }
      setLoading(false);
    }
    load();
  }, [quoteId, projectId]);

  // Calculate totals
  const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
  const remainder = quoteAmount - splitTotal;
  const isBalanced = Math.abs(remainder) < 1;

  // Update a split amount
  function updateAmount(index: number, newAmount: number) {
    setSplits((prev) =>
      prev.map((s, i) => (i === index ? { ...s, amount: newAmount } : s))
    );
  }

  // Remove a split
  function removeSplit(index: number) {
    setSplits((prev) => prev.filter((_, i) => i !== index));
  }

  // Add a new split from available lines
  function addSplit(lineId: string) {
    const line = allLines.find((l) => l.id === lineId);
    if (!line) return;
    // Don't add if already in splits
    if (splits.some((s) => s.line_item_id === lineId)) return;

    setSplits((prev) => [
      ...prev,
      {
        line_item_id: lineId,
        description: line.description,
        amount: Math.max(0, remainder),
        reason: "Manually added",
        trade: line.trade,
        budgeted_cost: line.budgeted_cost,
      },
    ]);
  }

  // Put entire amount on one line
  function assignToSingleLine(lineId: string) {
    const line = allLines.find((l) => l.id === lineId);
    if (!line) return;
    setSplits([
      {
        line_item_id: lineId,
        description: line.description,
        amount: quoteAmount,
        reason: "Full amount assigned",
        trade: line.trade,
        budgeted_cost: line.budgeted_cost,
      },
    ]);
  }

  // Execute the split
  async function handleConfirm() {
    if (!isBalanced) return;
    setSaving(true);
    try {
      const res = await fetch("/api/split-quote/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId,
          projectId,
          splits: splits.map((s) => ({
            line_item_id: s.line_item_id,
            amount: s.amount,
            description: s.description,
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

  // Lines not yet in the split
  const availableLines = allLines.filter(
    (l) => !splits.some((s) => s.line_item_id === l.id)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b">
          <div className="flex items-center gap-2 mb-1">
            <Split className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Split Quote to Budget</h2>
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
              AI is analyzing the scope...
            </div>
          ) : error ? (
            <div className="text-sm text-red-400 text-center py-8">{error}</div>
          ) : (
            <>
              {/* Split lines */}
              <div className="space-y-2">
                {splits.map((split, i) => (
                  <div
                    key={split.line_item_id}
                    className="rounded-lg border bg-muted/20 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{split.description}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {split.trade} — Budget: {fmt(split.budgeted_cost)}
                        </div>
                      </div>
                      <button
                        onClick={() => removeSplit(i)}
                        className="text-xs text-muted-foreground hover:text-red-400 px-1"
                      >
                        ×
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
                      {split.amount > split.budgeted_cost && split.budgeted_cost > 0 && (
                        <span className="text-[10px] text-red-400 flex items-center gap-0.5">
                          <AlertTriangle className="h-3 w-3" />
                          over
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground italic">{split.reason}</div>
                  </div>
                ))}
              </div>

              {/* Add more lines */}
              {availableLines.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                    Add budget line
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {availableLines.map((line) => (
                      <button
                        key={line.id}
                        onClick={() => splits.length === 0 ? assignToSingleLine(line.id) : addSplit(line.id)}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/10 border border-dashed border-border/50 hover:border-primary/50 hover:bg-muted/30 transition-colors text-left"
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

              {/* Balance indicator */}
              <div className={`rounded-lg p-3 text-center text-sm font-medium ${
                isBalanced
                  ? "bg-green-500/10 text-green-500 border border-green-500/20"
                  : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
              }`}>
                {isBalanced ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <Check className="h-4 w-4" />
                    Balanced — {fmt(splitTotal)} = {fmt(quoteAmount)}
                  </span>
                ) : (
                  <span>
                    {fmt(splitTotal)} of {fmt(quoteAmount)} assigned — {fmt(Math.abs(remainder))} {remainder > 0 ? "remaining" : "over"}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!isBalanced || loading || saving || splits.length === 0}
            onClick={handleConfirm}
            className="gap-1.5"
          >
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Creating invoices...
              </>
            ) : (
              <>
                <Check className="h-3 w-3" />
                Confirm Split ({splits.length} invoice{splits.length !== 1 ? "s" : ""})
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
