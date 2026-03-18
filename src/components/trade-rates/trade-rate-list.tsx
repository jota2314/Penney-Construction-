"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Trash2, Plus, Search } from "lucide-react";
import { TradeRateFormDialog } from "./trade-rate-form-dialog";
import { TradeRateDeleteDialog } from "./trade-rate-delete-dialog";
import { UNIT_TYPE_SHORT } from "@/lib/constants/trade-rate";
import type { TradeRate, UnitType, ProjectType } from "@/types/database";

const fmt = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(val);

function markup(cost: number, price: number): string {
  if (cost <= 0) return "—";
  return `${(((price - cost) / cost) * 100).toFixed(0)}%`;
}

type TabKey = "all" | "general" | ProjectType;

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "general", label: "General" },
  { key: "bathroom", label: "Bathroom" },
  { key: "kitchen", label: "Kitchen" },
  { key: "remodel", label: "Remodel" },
  { key: "addition", label: "Addition" },
  { key: "new_construction", label: "New Construction" },
];

export function TradeRateList({ rates }: { rates: TradeRate[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [createForType, setCreateForType] = useState<ProjectType | null>(null);
  const [editRate, setEditRate] = useState<TradeRate | null>(null);
  const [deleteRate, setDeleteRate] = useState<TradeRate | null>(null);

  function filterRates(tab: TabKey) {
    let tabFiltered = rates;
    if (tab === "general") {
      tabFiltered = rates.filter((r) => !r.project_type);
    } else if (tab !== "all") {
      tabFiltered = rates.filter((r) => r.project_type === tab);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      tabFiltered = tabFiltered.filter(
        (r) =>
          r.trade_name.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q)
      );
    }

    return tabFiltered;
  }

  function handleAddRate() {
    setCreateForType(
      activeTab !== "all" && activeTab !== "general"
        ? (activeTab as ProjectType)
        : null
    );
    setFormOpen(true);
  }

  function getTabCount(tab: TabKey) {
    if (tab === "all") return rates.length;
    if (tab === "general") return rates.filter((r) => !r.project_type).length;
    return rates.filter((r) => r.project_type === tab).length;
  }

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Cost Book</h2>
        <p className="text-muted-foreground text-sm">
          Per-trade pricing rates by project type. AI uses these when generating estimates.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
            {TABS.map((tab) => {
              const count = getTabCount(tab.key);
              return (
                <TabsTrigger
                  key={tab.key}
                  value={tab.key}
                  className="text-xs sm:text-sm whitespace-nowrap"
                >
                  {tab.label}
                  {count > 0 && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {/* Shared controls */}
        <div className="flex items-center justify-between gap-3 mt-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search trades..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button onClick={handleAddRate} className="min-h-[44px]">
            <Plus className="mr-2 h-4 w-4" />
            Add Rate
          </Button>
        </div>

        {/* Tab content — all tabs share the same table renderer */}
        {TABS.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className="mt-4">
            <RateTable
              rates={filterRates(tab.key)}
              totalCount={getTabCount(tab.key)}
              onEdit={setEditRate}
              onDelete={setDeleteRate}
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* Create dialog */}
      <TradeRateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultProjectType={createForType}
        onSuccess={() => {
          setFormOpen(false);
          router.refresh();
        }}
      />

      {/* Edit dialog */}
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

      {/* Delete dialog */}
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

function RateTable({
  rates,
  totalCount,
  onEdit,
  onDelete,
}: {
  rates: TradeRate[];
  totalCount: number;
  onEdit: (rate: TradeRate) => void;
  onDelete: (rate: TradeRate) => void;
}) {
  return (
    <>
      <div className="text-xs text-muted-foreground mb-2">
        {rates.length === totalCount
          ? `${rates.length} trade rates`
          : `${rates.length} of ${totalCount} trade rates`}
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Trade</TableHead>
              <TableHead className="hidden sm:table-cell">Unit</TableHead>
              <TableHead className="text-right">Our Cost</TableHead>
              <TableHead className="text-right">Our Price</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Markup</TableHead>
              <TableHead className="text-right hidden md:table-cell">Samples</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {totalCount === 0
                    ? "No trade rates in this category yet."
                    : "No trades match your search."}
                </TableCell>
              </TableRow>
            ) : (
              rates.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{rate.trade_name}</div>
                    {rate.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1 hidden sm:block">
                        {rate.description}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground sm:hidden">
                      {UNIT_TYPE_SHORT[rate.unit_type as UnitType]}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                    {UNIT_TYPE_SHORT[rate.unit_type as UnitType]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {fmt(rate.avg_cost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    {fmt(rate.avg_price)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm hidden sm:table-cell">
                    {markup(rate.avg_cost, rate.avg_price)}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground hidden md:table-cell">
                    {rate.sample_count || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onEdit(rate)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => onDelete(rate)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
