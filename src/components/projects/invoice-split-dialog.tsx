"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Split, Check, AlertTriangle, Plus, X } from "lucide-react";

interface SplitLine {
  line_item_id: string;
  line_description: string;
  amount: number;
  note: string;
  trade: string | null;
  budgeted_cost: number;
}

interface BudgetLine {
  id: string;
  description: string;
  trade: string | null;
  budgeted_cost: number;
}

interface InvoiceSplitDialogProps {
  invoiceId: string;
  projectId: string;
  vendorName: string;
  invoiceAmount: number;
  onClose: () => void;
  onComplete: () => void;
}

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);

export function InvoiceSplitDialog({ invoiceId, projectId, vendorName, invoiceAmount, onClose, onComplete }: InvoiceSplitDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splits, setSplits] = useState<SplitLine[]>([]);
  const [allLines, setAllLines] = useState<BudgetLine[]>([]);

  useEffect(() => {
    fetch("/api/split-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId, projectId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else { setSplits(data.suggested_splits || []); setAllLines(data.line_items || []); }
        setLoading(false);
      })
      .catch((err) => { setError(String(err)); setLoading(false); });
  }, [invoiceId, projectId]);

  const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
  const remainder = invoiceAmount - splitTotal;
  const isBalanced = Math.abs(remainder) < 1;

  function updateAmount(i: number, v: number) { setSplits((p) => p.map((s, j) => j === i ? { ...s, amount: v } : s)); }
  function updateNote(i: number, v: string) { setSplits((p) => p.map((s, j) => j === i ? { ...s, note: v } : s)); }
  function removeSplit(i: number) { setSplits((p) => p.filter((_, j) => j !== i)); }

  function addSplit(lineId: string) {
    const line = allLines.find((l) => l.id === lineId);
    if (!line || splits.some((s) => s.line_item_id === lineId)) return;
    setSplits((p) => [...p, { line_item_id: lineId, line_description: line.description, amount: Math.max(0, remainder), note: "", trade: line.trade, budgeted_cost: line.budgeted_cost }]);
  }

  async function handleConfirm() {
    if (!isBalanced) return;
    setSaving(true);
    try {
      const res = await fetch("/api/split-invoice/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, splits: splits.map((s) => ({ line_item_id: s.line_item_id, amount: s.amount, note: s.note || s.line_description })) }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); setSaving(false); }
      else onComplete();
    } catch (err) { setError(String(err)); setSaving(false); }
  }

  const availableLines = allLines.filter((l) => !splits.some((s) => s.line_item_id === l.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b">
          <div className="flex items-center gap-2 mb-1">
            <Split className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Split Invoice to Budget Lines</h2>
          </div>
          <p className="text-xs text-muted-foreground">{vendorName} — {fmt(invoiceAmount)}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> AI analyzing invoice...
            </div>
          ) : error ? (
            <div className="text-sm text-red-400 text-center py-8">{error}</div>
          ) : (
            <>
              <div className="space-y-2">
                {splits.map((split, i) => (
                  <div key={split.line_item_id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{split.line_description}</div>
                        <div className="text-[10px] text-muted-foreground">{split.trade} — Budget: {fmt(split.budgeted_cost)}</div>
                      </div>
                      <button onClick={() => removeSplit(i)} className="text-muted-foreground hover:text-red-400 p-1"><X className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">$</span>
                      <input type="number" value={split.amount} onChange={(e) => updateAmount(i, Number(e.target.value) || 0)} className="flex-1 bg-background border rounded px-2 py-1 text-sm font-medium tabular-nums" step="100" />
                    </div>
                    <input type="text" value={split.note} onChange={(e) => updateNote(i, e.target.value)} placeholder="What this covers" className="w-full bg-background border rounded px-2 py-1 text-xs text-muted-foreground" />
                  </div>
                ))}
              </div>

              {availableLines.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1"><Plus className="h-3 w-3" /> Add budget line</div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {availableLines.map((line) => (
                      <button key={line.id} onClick={() => addSplit(line.id)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-muted/10 border border-dashed border-border/50 hover:border-primary/50 hover:bg-muted/30 transition-colors text-left">
                        <div><div className="text-xs font-medium">{line.description}</div><div className="text-[10px] text-muted-foreground">{line.trade}</div></div>
                        <div className="text-xs text-muted-foreground">{fmt(line.budgeted_cost)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={`rounded-lg p-3 text-center text-sm font-medium ${isBalanced ? "bg-green-500/10 text-green-500 border border-green-500/20" : "bg-amber-500/10 text-amber-500 border border-amber-500/20"}`}>
                {isBalanced ? <span className="flex items-center justify-center gap-1.5"><Check className="h-4 w-4" /> Balanced — {fmt(splitTotal)}</span>
                  : <span className="flex items-center justify-center gap-1.5"><AlertTriangle className="h-4 w-4" /> {fmt(splitTotal)} of {fmt(invoiceAmount)} — {fmt(Math.abs(remainder))} {remainder > 0 ? "remaining" : "over"}</span>}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!isBalanced || loading || saving || splits.length === 0} onClick={handleConfirm} className="gap-1.5">
            {saving ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</> : splits.length === 1 ? <><Check className="h-3 w-3" /> Link to Budget Line</> : <><Check className="h-3 w-3" /> Split into {splits.length} Invoices</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
