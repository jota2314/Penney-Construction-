"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Link as LinkIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LineItem {
  id: string;
  description: string;
  trade: string | null;
  total_cost: number | null;
  needs_sub_quote: boolean | null;
  awarded_bid_id?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "bid" | "quote";
  recordId: string;
  recordLabel: string;       // e.g. "Cameron Electric — $14,000"
  defaultTrade?: string | null;
  lineItems: LineItem[];
  onLinked?: () => void;
}

const fmt = (val: number | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    .format(Number(val) || 0);

export function LinkToLineDialog({
  open, onOpenChange, type, recordId, recordLabel, defaultTrade, lineItems, onLinked,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rank lines: trade match first, then alpha
  const ranked = useMemo(() => {
    const tradeKey = (defaultTrade || "").toLowerCase().trim();
    const q = query.toLowerCase().trim();
    return lineItems
      .map((li) => {
        const t = (li.trade || "").toLowerCase();
        const tradeMatch = tradeKey ? (t.includes(tradeKey) || tradeKey.includes(t)) : false;
        const matchesQuery = !q ||
          li.description.toLowerCase().includes(q) ||
          (li.trade?.toLowerCase().includes(q) ?? false);
        return { li, tradeMatch, matchesQuery };
      })
      .filter((r) => r.matchesQuery)
      .sort((a, b) => {
        if (a.tradeMatch !== b.tradeMatch) return a.tradeMatch ? -1 : 1;
        return a.li.description.localeCompare(b.li.description);
      });
  }, [lineItems, defaultTrade, query]);

  async function handleLink(lineItemId: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/link-to-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id: recordId, line_item_id: lineItemId }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setSaving(false);
        return;
      }
      onOpenChange(false);
      onLinked?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Link to estimate line</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {recordLabel}
            {defaultTrade && <span> · trade: <span className="text-amber-400">{defaultTrade}</span></span>}
          </p>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search line items by description or trade..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {ranked.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              No line items match.
            </div>
          )}
          {ranked.map(({ li, tradeMatch }) => (
            <button
              key={li.id}
              onClick={() => handleLink(li.id)}
              disabled={saving}
              className={cn(
                "w-full text-left p-2.5 rounded-md border transition-colors",
                "hover:bg-accent/50 disabled:opacity-50",
                tradeMatch ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{li.description}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                    {li.trade && <span className="capitalize">{li.trade}</span>}
                    <span className="tabular-nums">est {fmt(li.total_cost)}</span>
                    {li.needs_sub_quote && <Badge variant="outline" className="text-[9px] py-0 h-4">needs quote</Badge>}
                    {tradeMatch && <span className="text-amber-400">trade match</span>}
                  </div>
                </div>
                <LinkIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </div>
            </button>
          ))}
        </div>

        {error && <div className="text-xs text-destructive">{error}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {saving && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Linking...
            </span>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
