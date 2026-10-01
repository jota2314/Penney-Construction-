"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
  DollarSign,
  ImageOff,
  Minus,
  Package,
  Plus,
  Search,
  Truck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import { WAREHOUSE_CATEGORIES, categoryLabel } from "@/lib/constants/warehouse";
import { DEFAULT_OVERDUE_DAYS, formatQty, isOverdue } from "@/lib/warehouse/checkouts";
import { ItemFormDialog } from "./item-form-dialog";
import { AdjustStockDialog } from "./adjust-stock-dialog";
import { CheckOutDialog } from "./check-out-dialog";
import { CheckInDialog } from "./check-in-dialog";
import { ItemThumb } from "./item-photo";
import type { WarehouseEmployee, WarehouseSummary } from "@/lib/actions/warehouse";
import type { WarehouseItem, WarehouseOpenCheckout } from "@/types/database";

interface WarehouseDashboardProps {
  items: WarehouseItem[];
  summary: WarehouseSummary;
  projects: { id: string; name: string; project_number: string }[];
  checkouts: WarehouseOpenCheckout[];
  employees: WarehouseEmployee[];
  thumbUrls: Record<string, string>;
}

export function WarehouseDashboard({
  items,
  summary,
  projects,
  checkouts,
  employees,
  thumbUrls,
}: WarehouseDashboardProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [noPhotoOnly, setNoPhotoOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [receiveItem, setReceiveItem] = useState<WarehouseItem | null>(null);
  // null = closed; "" = open with nothing picked yet; otherwise that item.
  const [checkOutItemId, setCheckOutItemId] = useState<string | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);

  const noPhotoCount = useMemo(() => items.filter((i) => !i.photo_path).length, [items]);

  const outByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of checkouts) {
      map.set(c.item_id, (map.get(c.item_id) ?? 0) + c.quantity_outstanding);
    }
    return map;
  }, [checkouts]);

  const overdueCount = useMemo(
    () => checkouts.filter((c) => isOverdue(c.checked_out_at, DEFAULT_OVERDUE_DAYS)).length,
    [checkouts]
  );

  const usedCategories = useMemo(() => {
    const present = new Set(items.map((i) => i.category));
    return WAREHOUSE_CATEGORIES.filter((c) => present.has(c.value));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (category && i.category !== category) return false;
      if (lowOnly && i.quantity_on_hand > i.reorder_point) return false;
      if (noPhotoOnly && i.photo_path) return false;
      if (
        q &&
        !i.name.toLowerCase().includes(q) &&
        !i.sku.toLowerCase().includes(q) &&
        !(i.location ?? "").toLowerCase().includes(q) &&
        !(i.vendor ?? "").toLowerCase().includes(q) &&
        (i.barcode ?? "").toLowerCase() !== q
      )
        return false;
      return true;
    });
  }, [items, search, category, lowOnly, noPhotoOnly]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
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
        <Link href="/warehouse/out">
          <StatCard
            icon={Truck}
            iconClass="bg-blue-500/15 text-blue-500"
            value={checkouts.length}
            label="Out on Jobs"
            badge={
              overdueCount > 0
                ? `${overdueCount} out over ${DEFAULT_OVERDUE_DAYS} days`
                : undefined
            }
          />
        </Link>
        <Link href="/warehouse/orders" className="col-span-2 lg:col-span-1">
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
            placeholder="Search by name, SKU, barcode, location, vendor..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCheckOutItemId("")} className="flex-1 sm:flex-none">
            <ArrowUpFromLine className="h-4 w-4 mr-1" />
            Check Out
          </Button>
          <Button
            variant="outline"
            onClick={() => setCheckInOpen(true)}
            className="flex-1 sm:flex-none"
          >
            <ArrowDownToLine className="h-4 w-4 mr-1" />
            Check In
          </Button>
          <Button
            variant="outline"
            onClick={() => setAddOpen(true)}
            className="flex-1 sm:flex-none"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Filter chips */}
      {items.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center">
          <button
            type="button"
            onClick={() => setNoPhotoOnly((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs border transition-colors",
              noPhotoOnly
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40 font-medium"
                : "text-muted-foreground border-border hover:border-amber-500/40"
            )}
          >
            <ImageOff className="h-3 w-3" />
            No photo ({noPhotoCount})
          </button>
          {usedCategories.length > 0 && (
            <>
              <span className="h-4 w-px bg-border mx-1" aria-hidden />
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
            </>
          )}
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
            const out = outByItem.get(item.id) ?? 0;
            return (
              <Card
                key={item.id}
                className="p-3 sm:p-4 flex items-center gap-3 hover:border-amber-500/40 transition-colors"
              >
                <Link
                  href={`/warehouse/items/${item.id}`}
                  className="shrink-0"
                  tabIndex={-1}
                  aria-hidden
                >
                  <ItemThumb url={thumbUrls[item.id]} name={item.name} />
                </Link>
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
                    {out > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                      >
                        {formatQty(out)} out
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
                    onClick={() => setReceiveItem(item)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    title="Check out to a job"
                    onClick={() => setCheckOutItemId(item.id)}
                    disabled={item.quantity_on_hand <= 0}
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
      {receiveItem && (
        <AdjustStockDialog
          key={receiveItem.id}
          open
          onOpenChange={(open) => !open && setReceiveItem(null)}
          item={receiveItem}
          initialMode="receive"
        />
      )}
      {checkOutItemId !== null && (
        <CheckOutDialog
          key={checkOutItemId || "pick"}
          open
          onOpenChange={(open) => !open && setCheckOutItemId(null)}
          items={items}
          fixedItemId={checkOutItemId || undefined}
          projects={projects}
          employees={employees}
          thumbUrls={thumbUrls}
        />
      )}
      {checkInOpen && (
        <CheckInDialog
          open
          onOpenChange={setCheckInOpen}
          checkouts={checkouts}
          employees={employees}
          thumbUrls={thumbUrls}
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
