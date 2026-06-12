"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ClipboardList,
  DollarSign,
  Minus,
  Package,
  Plus,
  Search,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import { WAREHOUSE_CATEGORIES, categoryLabel } from "@/lib/constants/warehouse";
import { ItemFormDialog } from "./item-form-dialog";
import { AdjustStockDialog } from "./adjust-stock-dialog";
import type { WarehouseSummary } from "@/lib/actions/warehouse";
import type { WarehouseItem } from "@/types/database";

interface WarehouseDashboardProps {
  items: WarehouseItem[];
  summary: WarehouseSummary;
  projects: { id: string; name: string; project_number: string }[];
}

export function WarehouseDashboard({
  items,
  summary,
  projects,
}: WarehouseDashboardProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<{
    item: WarehouseItem;
    mode: "receive" | "issue";
  } | null>(null);

  const usedCategories = useMemo(() => {
    const present = new Set(items.map((i) => i.category));
    return WAREHOUSE_CATEGORIES.filter((c) => present.has(c.value));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (category && i.category !== category) return false;
      if (lowOnly && i.quantity_on_hand > i.reorder_point) return false;
      if (
        q &&
        !i.name.toLowerCase().includes(q) &&
        !i.sku.toLowerCase().includes(q) &&
        !(i.location ?? "").toLowerCase().includes(q) &&
        !(i.vendor ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [items, search, category, lowOnly]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon={Package}
          iconClass="bg-blue-500/15 text-blue-500"
          value={summary.activeItems}
          label="Items in Catalog"
        />
        <button
          type="button"
          onClick={() => setLowOnly((v) => !v)}
          className="text-left"
        >
          <StatCard
            icon={AlertTriangle}
            iconClass={
              summary.lowStockItems > 0
                ? "bg-red-500/15 text-red-500"
                : "bg-emerald-500/15 text-emerald-500"
            }
            value={summary.lowStockItems}
            label="Low Stock"
            valueClass={summary.lowStockItems > 0 ? "text-red-500" : undefined}
            active={lowOnly}
          />
        </button>
        <StatCard
          icon={DollarSign}
          iconClass="bg-emerald-500/15 text-emerald-500"
          value={formatCurrency(summary.inventoryValue)}
          label="Inventory Value"
        />
        <Link href="/warehouse/orders">
          <StatCard
            icon={ClipboardList}
            iconClass="bg-amber-500/15 text-amber-600"
            value={summary.openOrders}
            label="Open Orders"
            badge={
              summary.pendingOrders > 0
                ? `${summary.pendingOrders} need review`
                : undefined
            }
          />
        </Link>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, SKU, location, vendor..."
            className="pl-9"
          />
        </div>
        <Button onClick={() => setAddOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4 mr-1" />
          Add Item
        </Button>
      </div>

      {/* Category chips */}
      {usedCategories.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <CategoryChip
            label="All"
            active={category === null}
            onClick={() => setCategory(null)}
          />
          {usedCategories.map((c) => (
            <CategoryChip
              key={c.value}
              label={c.label}
              active={category === c.value}
              onClick={() => setCategory(category === c.value ? null : c.value)}
            />
          ))}
        </div>
      )}

      {/* Item list */}
      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {items.length === 0 ? (
            <>
              <Package className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium text-foreground mb-1">
                The warehouse is empty
              </p>
              <p className="text-sm">
                Click &quot;Add Item&quot; to start building the catalog — name,
                quantity on hand, and where it lives on the shelf.
              </p>
            </>
          ) : (
            <p className="text-sm">No items match the current filters.</p>
          )}
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((item) => {
            const low = item.quantity_on_hand <= item.reorder_point;
            return (
              <Card
                key={item.id}
                className="p-3 sm:p-4 flex items-center gap-3 hover:border-amber-500/40 transition-colors"
              >
                <Link
                  href={`/warehouse/items/${item.id}`}
                  className="flex-1 min-w-0"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{item.name}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {categoryLabel(item.category)}
                    </Badge>
                    {low && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">
                        Low
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {item.sku}
                    {item.location && <> · {item.location}</>}
                    {item.vendor && <> · {item.vendor}</>}
                  </p>
                </Link>

                <div className="text-right shrink-0">
                  <p
                    className={cn(
                      "text-xl font-bold leading-tight",
                      low ? "text-red-500" : "text-foreground"
                    )}
                  >
                    {item.quantity_on_hand}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {item.unit}
                  </p>
                </div>

                <div className="flex flex-col gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    title="Receive stock"
                    onClick={() => setAdjustTarget({ item, mode: "receive" })}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    title="Issue stock"
                    onClick={() => setAdjustTarget({ item, mode: "issue" })}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ItemFormDialog open={addOpen} onOpenChange={setAddOpen} />
      {adjustTarget && (
        <AdjustStockDialog
          key={`${adjustTarget.item.id}-${adjustTarget.mode}`}
          open
          onOpenChange={(open) => !open && setAdjustTarget(null)}
          item={adjustTarget.item}
          initialMode={adjustTarget.mode}
          projects={projects}
        />
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  iconClass,
  value,
  label,
  valueClass,
  badge,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  value: number | string;
  label: string;
  valueClass?: string;
  badge?: string;
  active?: boolean;
}) {
  return (
    <Card
      className={cn(
        "p-4 h-full hover:border-amber-500/40 transition-colors",
        active && "border-amber-500/60"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            iconClass
          )}
        >
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <p className={cn("text-xl font-bold leading-tight truncate", valueClass)}>
            {value}
          </p>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
            {label}
          </p>
        </div>
      </div>
      {badge && (
        <Badge variant="destructive" className="text-[10px] mt-2">
          {badge}
        </Badge>
      )}
    </Card>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs border transition-colors",
        active
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40 font-medium"
          : "text-muted-foreground border-border hover:border-amber-500/40"
      )}
    >
      {label}
    </button>
  );
}
