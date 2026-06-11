"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArrowDown, ArrowUp, Pencil, SlidersHorizontal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { categoryLabel, TRANSACTION_TYPE_META } from "@/lib/constants/warehouse";
import { archiveWarehouseItem } from "@/lib/actions/warehouse";
import { ItemFormDialog } from "./item-form-dialog";
import { AdjustStockDialog } from "./adjust-stock-dialog";
import type { WarehouseItem, WarehouseTransaction } from "@/types/database";

interface WarehouseItemDetailProps {
  item: WarehouseItem;
  transactions: WarehouseTransaction[];
  projects: { id: string; name: string; project_number: string }[];
}

export function WarehouseItemDetail({
  item,
  transactions,
  projects,
}: WarehouseItemDetailProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [adjustMode, setAdjustMode] = useState<"receive" | "issue" | "adjust" | null>(
    null
  );

  const low = item.quantity_on_hand <= item.reorder_point;

  const handleArchive = () => {
    if (!confirm(`Archive "${item.name}"? It will no longer show in the catalog.`))
      return;
    startTransition(async () => {
      const result = await archiveWarehouseItem(item.id);
      if (!result.error) router.push("/warehouse");
    });
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6 max-w-3xl">
      {/* Stock + actions */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold">{item.name}</h2>
              <Badge variant="outline" className="text-[10px]">
                {categoryLabel(item.category)}
              </Badge>
              {low && (
                <Badge variant="destructive" className="text-[10px]">
                  Low stock
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{item.sku}</p>
          </div>
          <div className="text-right">
            <p
              className={cn(
                "text-4xl font-bold",
                low ? "text-red-500" : "text-foreground"
              )}
            >
              {item.quantity_on_hand}
            </p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {item.unit} on hand
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <Button size="sm" onClick={() => setAdjustMode("receive")}>
            <ArrowDown className="h-4 w-4 mr-1" />
            Receive
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAdjustMode("issue")}>
            <ArrowUp className="h-4 w-4 mr-1" />
            Issue
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAdjustMode("adjust")}>
            <SlidersHorizontal className="h-4 w-4 mr-1" />
            Recount
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-500 hover:text-red-600"
            onClick={handleArchive}
            disabled={pending}
          >
            <Archive className="h-4 w-4 mr-1" />
            Archive
          </Button>
        </div>
      </Card>

      {/* Details */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">Details</h3>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
          <DetailField label="Location" value={item.location} />
          <DetailField label="Vendor" value={item.vendor} />
          <DetailField
            label="Unit cost"
            value={item.unit_cost != null ? formatCurrency(item.unit_cost, "two") : null}
          />
          <DetailField label="Low stock alert" value={`${item.reorder_point} ${item.unit}`} />
          <DetailField
            label="Reorder qty"
            value={
              item.reorder_quantity != null
                ? `${item.reorder_quantity} ${item.unit}`
                : null
            }
          />
          <DetailField
            label="Stock value"
            value={
              item.unit_cost != null
                ? formatCurrency(item.quantity_on_hand * item.unit_cost)
                : null
            }
          />
        </dl>
        {item.description && (
          <p className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">
            {item.description}
          </p>
        )}
      </Card>

      {/* History */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">Activity</h3>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock movements yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border/50">
            {transactions.map((tx) => {
              const meta = TRANSACTION_TYPE_META[tx.type];
              const positive = tx.quantity_change > 0;
              return (
                <div key={tx.id} className="py-2.5 flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] shrink-0 w-24 justify-center", meta.badgeClass)}
                  >
                    {meta.label}
                  </Badge>
                  <div className="flex-1 min-w-0 text-sm">
                    <p className="truncate">
                      {tx.order_id ? (
                        <Link
                          href={`/warehouse/orders/${tx.order_id}`}
                          className="hover:underline"
                        >
                          {tx.notes || "Material order"}
                        </Link>
                      ) : (
                        tx.notes || "—"
                      )}
                      {tx.projects?.name && (
                        <span className="text-muted-foreground"> · {tx.projects.name}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tx.performed_by_name || "Unknown"} ·{" "}
                      {new Date(tx.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        positive ? "text-emerald-500" : "text-orange-500"
                      )}
                    >
                      {positive ? "+" : ""}
                      {tx.quantity_change}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      → {tx.quantity_after}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {editOpen && (
        <ItemFormDialog open onOpenChange={setEditOpen} item={item} />
      )}
      {adjustMode && (
        <AdjustStockDialog
          key={adjustMode}
          open
          onOpenChange={(open) => !open && setAdjustMode(null)}
          item={item}
          initialMode={adjustMode}
          projects={projects}
        />
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}
