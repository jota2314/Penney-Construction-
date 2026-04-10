"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, Pencil, Trash2, Plus, Search, Info } from "lucide-react";
import { TradeRateFormDialog } from "./trade-rate-form-dialog";
import { TradeRateDeleteDialog } from "./trade-rate-delete-dialog";
import { UNIT_TYPE_SHORT } from "@/lib/constants/trade-rate";
import type { TradeRate, UnitType } from "@/types/database";
import { cn } from "@/lib/utils";

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: val < 100 ? 2 : 0,
    maximumFractionDigits: val < 100 ? 2 : 0,
  }).format(val);

export function TradeRateList({ rates }: { rates: TradeRate[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editRate, setEditRate] = useState<TradeRate | null>(null);
  const [deleteRate, setDeleteRate] = useState<TradeRate | null>(null);
  const [expandedScope, setExpandedScope] = useState<string | null>(null);

  const q = search.toLowerCase().trim();
  const filtered = q
    ? rates.filter(
        (r) =>
          r.trade_name.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          r.trade_category?.toLowerCase().includes(q) ||
          r.scope_includes?.toLowerCase().includes(q)
      )
    : rates;

  // Group by trade_category
  const grouped = new Map<string, TradeRate[]>();
  for (const r of filtered) {
    const cat = r.trade_category || "Other";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(r);
  }

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Cost Book</h2>
        <p className="text-muted-foreground text-sm">
          {rates.length} rates across {new Set(rates.map((r) => r.trade_category)).size} trades — from real Penney project data
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search trades, scopes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setFormOpen(true)} className="min-h-[44px]">
          <Plus className="mr-2 h-4 w-4" />
          Add Rate
        </Button>
      </div>

      <div className="space-y-2">
        {Array.from(grouped.entries()).map(([category, items]) => (
          <CategorySection
            key={category}
            category={category}
            items={items}
            defaultOpen={!!q || grouped.size <= 5}
            expandedScope={expandedScope}
            onToggleScope={(id) => setExpandedScope(expandedScope === id ? null : id)}
            onEdit={setEditRate}
            onDelete={setDeleteRate}
          />
        ))}
        {grouped.size === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No rates match &quot;{search}&quot;
          </div>
        )}
      </div>

      <TradeRateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSuccess={() => {
          setFormOpen(false);
          router.refresh();
        }}
      />

      {editRate && (
        <TradeRateFormDialog
          open={!!editRate}
          onOpenChange={(open) => !open && setEditRate(null)}
          rate={editRate}
          onSuccess={() => {
            setEditRate(null);
            router.refresh();
          }}
        />
      )}

      {deleteRate && (
        <TradeRateDeleteDialog
          open={!!deleteRate}
          onOpenChange={(open) => !open && setDeleteRate(null)}
          rate={deleteRate}
          onSuccess={() => {
            setDeleteRate(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function CategorySection({
  category,
  items,
  defaultOpen,
  expandedScope,
  onToggleScope,
  onEdit,
  onDelete,
}: {
  category: string;
  items: TradeRate[];
  defaultOpen: boolean;
  expandedScope: string | null;
  onToggleScope: (id: string) => void;
  onEdit: (rate: TradeRate) => void;
  onDelete: (rate: TradeRate) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Group items by subcategory
  const subcats = new Map<string, TradeRate[]>();
  for (const item of items) {
    const sub = item.subcategory || "";
    if (!subcats.has(sub)) subcats.set(sub, []);
    subcats.get(sub)!.push(item);
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-3 rounded-lg bg-card border hover:bg-accent/50 transition-colors">
        <ChevronRight
          className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <span className="font-semibold text-sm flex-1 text-left">{category}</span>
        <span className="text-xs text-muted-foreground">{items.length} rates</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_60px_80px_80px_80px_64px] sm:grid-cols-[1fr_60px_90px_90px_90px_64px] gap-1 px-3 py-2 bg-muted/50 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            <div>Item</div>
            <div>Unit</div>
            <div className="text-right">Low</div>
            <div className="text-right">Mid</div>
            <div className="text-right">High</div>
            <div />
          </div>

          {Array.from(subcats.entries()).map(([subcat, subItems]) => (
            <div key={subcat}>
              {subcat && (
                <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground bg-muted/30 border-t">
                  {subcat}
                </div>
              )}
              {subItems.map((rate) => (
                <RateRow
                  key={rate.id}
                  rate={rate}
                  isExpanded={expandedScope === rate.id}
                  onToggleScope={() => onToggleScope(rate.id)}
                  onEdit={() => onEdit(rate)}
                  onDelete={() => onDelete(rate)}
                />
              ))}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RateRow({
  rate,
  isExpanded,
  onToggleScope,
  onEdit,
  onDelete,
}: {
  rate: TradeRate;
  isExpanded: boolean;
  onToggleScope: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const unit = UNIT_TYPE_SHORT[rate.unit_type as UnitType];
  const low = rate.min_price ? fmt(Number(rate.min_price)) : "—";
  const mid = fmt(rate.avg_price);
  const high = rate.max_price ? fmt(Number(rate.max_price)) : "—";

  return (
    <>
      <div className="grid grid-cols-[1fr_60px_80px_80px_80px_64px] sm:grid-cols-[1fr_60px_90px_90px_90px_64px] gap-1 px-3 py-2 border-t hover:bg-accent/30 transition-colors items-center">
        <div className="min-w-0">
          <button
            onClick={rate.scope_includes ? onToggleScope : undefined}
            className={cn(
              "text-sm font-medium text-left truncate block w-full",
              rate.scope_includes && "hover:text-amber-500 cursor-pointer"
            )}
            title={rate.description || rate.trade_name}
          >
            {rate.trade_name}
            {rate.scope_includes && (
              <Info className="inline ml-1 h-3 w-3 text-muted-foreground" />
            )}
          </button>
          {rate.description && (
            <div className="text-[11px] text-muted-foreground truncate hidden sm:block">
              {rate.description}
            </div>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{unit}</div>
        <div className="text-right tabular-nums text-sm text-muted-foreground">{low}</div>
        <div className="text-right tabular-nums text-sm font-medium">{mid}</div>
        <div className="text-right tabular-nums text-sm text-muted-foreground">{high}</div>
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {isExpanded && rate.scope_includes && (
        <div className="px-3 py-2 bg-muted/30 border-t text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Includes:</span> {rate.scope_includes}
          {rate.data_sources && rate.data_sources.length > 0 && (
            <span className="ml-2 text-[10px]">
              (Source: {rate.data_sources.join(", ")})
            </span>
          )}
        </div>
      )}
    </>
  );
}
