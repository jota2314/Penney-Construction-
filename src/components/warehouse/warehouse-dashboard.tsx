"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
  DollarSign,
  ImageIcon,
  ImageOff,
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
import { WAREHOUSE_CATEGORIES } from "@/lib/constants/warehouse";
import { DEFAULT_OVERDUE_DAYS, isOverdue } from "@/lib/warehouse/checkouts";
import { matchesMaterial } from "@/lib/warehouse/intelligence";
import { ItemFormDialog } from "./item-form-dialog";
import { AdjustStockDialog } from "./adjust-stock-dialog";
import { CheckOutDialog } from "./check-out-dialog";
import { CheckInDialog } from "./check-in-dialog";
import { WarehouseProductCard } from "./warehouse-product-card";
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
  const [photoFilter, setPhotoFilter] = useState<"all" | "with" | "without">("all");
  const [sort, setSort] = useState("photos");
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
      if (photoFilter === "without" && i.photo_path) return false;
      if (photoFilter === "with" && !i.photo_path) return false;
      if (q && !matchesMaterial(i, q)) return false;
      return true;
    }).sort((a, b) => {
      if (sort === "photos") {
        const photoOrder = Number(!!b.photo_path) - Number(!!a.photo_path);
        if (photoOrder) return photoOrder;
      }
      if (sort === "stock") {
        const stockOrder = a.quantity_on_hand - b.quantity_on_hand;
        if (stockOrder) return stockOrder;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
  }, [items, search, category, lowOnly, photoFilter, sort]);

  const hasFilters = !!search || !!category || lowOnly || photoFilter !== "all";
  function clearFilters() {
    setSearch("");
    setCategory(null);
    setLowOnly(false);
    setPhotoFilter("all");
  }

  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-4 sm:gap-6">
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
          aria-pressed={lowOnly}
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

      <section aria-labelledby="warehouse-catalog-heading" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Your warehouse, at a glance</p>
            <h2 id="warehouse-catalog-heading" className="text-2xl font-bold tracking-tight">Shop the warehouse</h2>
            <p className="mt-1 text-sm text-muted-foreground">Find it. Check the shelf. Get it to the job.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCheckInOpen(true)} className="h-11 flex-1 sm:flex-none">
              <ArrowDownToLine className="size-4" />Check in
            </Button>
            <Button variant="outline" onClick={() => setAddOpen(true)} className="h-11 flex-1 sm:flex-none">
              <Plus className="size-4" />Add item
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search warehouse catalog" placeholder="Search materials, tools, SKU or shelf..." className="h-12 bg-card pl-10 text-base shadow-sm" />
          </div>
          <Button onClick={() => setCheckOutItemId("")} className="h-12 px-3 sm:px-4">
            <ArrowUpFromLine className="size-4" /><span className="hidden sm:inline">Check out to a job</span><span className="sm:hidden">Check out</span>
          </Button>
        </div>

        {items.length > 0 && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Catalog categories">
              <CategoryChip label="All departments" active={category === null} onClick={() => setCategory(null)} />
              {usedCategories.map((c) => <CategoryChip key={c.value} label={c.label} active={category === c.value} onClick={() => setCategory(category === c.value ? null : c.value)} />)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryChip label={`With photos (${items.length - noPhotoCount})`} icon={ImageIcon} active={photoFilter === "with"} onClick={() => setPhotoFilter(photoFilter === "with" ? "all" : "with")} />
              <CategoryChip label={`Needs photos (${noPhotoCount})`} icon={ImageOff} active={photoFilter === "without"} onClick={() => setPhotoFilter(photoFilter === "without" ? "all" : "without")} />
              <CategoryChip label="Low stock" icon={AlertTriangle} active={lowOnly} onClick={() => setLowOnly(!lowOnly)} />
              {hasFilters && <Button variant="ghost" className="h-10 px-3 text-xs text-muted-foreground" onClick={clearFilters}>Clear filters</Button>}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground" role="status"><span className="font-semibold text-foreground">{filtered.length}</span> {filtered.length === 1 ? "item" : "items"}{hasFilters ? ` of ${items.length}` : " in your warehouse"}</p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-10 max-w-44 rounded-md border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <option value="photos">Photos first</option>
              <option value="name">Name: A to Z</option>
              <option value="stock">Stock: low to high</option>
            </select>
          </label>
        </div>

        {filtered.length === 0 ? (
          <Card className="items-center gap-3 p-8 text-center text-muted-foreground">
            <Package className="size-10 opacity-40" />
            <p className="font-medium text-foreground">{items.length === 0 ? "Your catalog starts here" : "No items match these filters"}</p>
            <p className="max-w-sm text-sm">{items.length === 0 ? "Add a material or tool with its photo, stock count and shelf location." : "Try another name, SKU or shelf, or clear your filters to browse everything."}</p>
            <Button variant="outline" className="h-11" onClick={items.length === 0 ? () => setAddOpen(true) : clearFilters}>{items.length === 0 ? "Add your first item" : "Clear filters"}</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4" data-warehouse-catalog>
            {filtered.map((item) => (
              <WarehouseProductCard key={item.id} item={item} photoUrl={thumbUrls[item.id]} quantityOut={outByItem.get(item.id) ?? 0} onReceive={() => setReceiveItem(item)} onCheckOut={() => setCheckOutItemId(item.id)} />
            ))}
          </div>
        )}
      </section>

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
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        active
          ? "border-primary/50 bg-primary/10 font-semibold text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {label}
    </button>
  );
}
