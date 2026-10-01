"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Archive,
  ArrowDown,
  ArrowDownToLine,
  ArrowUpFromLine,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { categoryLabel, TRANSACTION_TYPE_META } from "@/lib/constants/warehouse";
import { archiveWarehouseItem, closeCheckoutAsUsed } from "@/lib/actions/warehouse";
import type { WarehouseEmployee } from "@/lib/actions/warehouse";
import {
  DEFAULT_OVERDUE_DAYS,
  daysOut,
  daysOutLabel,
  formatQty,
  formatShopDate,
  formatShopDateTime,
} from "@/lib/warehouse/checkouts";
import { ItemFormDialog } from "./item-form-dialog";
import { AdjustStockDialog } from "./adjust-stock-dialog";
import { CheckOutDialog } from "./check-out-dialog";
import { CheckInDialog } from "./check-in-dialog";
import { ItemPhotoCard } from "./item-photo";
import type {
  WarehouseItem,
  WarehouseOpenCheckout,
  WarehouseTransaction,
} from "@/types/database";

interface WarehouseItemDetailProps {
  item: WarehouseItem;
  transactions: WarehouseTransaction[];
  openCheckouts: WarehouseOpenCheckout[];
  photoUrl: string | null;
  canManagePhotos: boolean;
  projects: { id: string; name: string; project_number: string }[];
  employees: WarehouseEmployee[];
}

const CHECKOUT_BADGE =
  "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30";
const CHECKIN_BADGE =
  "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";

export function WarehouseItemDetail({
  item,
  transactions,
  openCheckouts,
  photoUrl,
  canManagePhotos,
  projects,
  employees,
}: WarehouseItemDetailProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [adjustMode, setAdjustMode] = useState<"receive" | "adjust" | null>(null);
  const [checkOutOpen, setCheckOutOpen] = useState(false);
  // null = closed; "" = open with a list to pick from; otherwise that checkout.
  const [checkInId, setCheckInId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const low = item.quantity_on_hand <= item.reorder_point;
  const totalOut = openCheckouts.reduce((sum, c) => sum + c.quantity_outstanding, 0);

  const handleArchive = () => {
    if (!confirm(`Archive "${item.name}"? It will no longer show in the catalog.`))
      return;
    startTransition(async () => {
      const result = await archiveWarehouseItem(item.id);
      if (!result.error) router.push("/warehouse");
    });
  };

  const markUsed = (c: WarehouseOpenCheckout) => {
    if (
      !confirm(
        `Mark the ${formatQty(c.quantity_outstanding)} ${c.unit} still out on ${c.project_name ?? "the job"} as used up? Nothing comes back into stock.`
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const result = await closeCheckoutAsUsed(c.id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6 max-w-3xl">
      <ItemPhotoCard
        itemId={item.id}
        itemName={item.name}
        photoUrl={photoUrl}
        canManage={canManagePhotos}
      />

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
            <p className="text-xs text-muted-foreground mt-1">
              {item.sku}
              {item.barcode && <> · Barcode {item.barcode}</>}
            </p>
          </div>
          <div className="text-right">
            <p
              className={cn(
                "text-4xl font-bold",
                low ? "text-red-500" : "text-foreground"
              )}
            >
              {formatQty(item.quantity_on_hand)}
            </p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {item.unit} on hand
            </p>
            {totalOut > 0 && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                {formatQty(totalOut)} out on jobs
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <Button
            size="sm"
            onClick={() => setCheckOutOpen(true)}
            disabled={item.quantity_on_hand <= 0}
          >
            <ArrowUpFromLine className="h-4 w-4 mr-1" />
            Check out
          </Button>
          {openCheckouts.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setCheckInId("")}>
              <ArrowDownToLine className="h-4 w-4 mr-1" />
              Check in
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAdjustMode("receive")}>
            <ArrowDown className="h-4 w-4 mr-1" />
            Receive
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

      {/* What's out right now */}
      {openCheckouts.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3">Out on jobs</h3>
          <div className="flex flex-col divide-y divide-border/50">
            {openCheckouts.map((c) => {
              const days = daysOut(c.checked_out_at);
              const overdue = days > DEFAULT_OVERDUE_DAYS;
              return (
                <div key={c.id} className="py-2.5 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0 text-sm">
                    <p className="truncate">
                      <span className="font-medium">
                        {formatQty(c.quantity_outstanding)} {c.unit}
                      </span>{" "}
                      · {c.project_name ?? "No job"} · {c.employee_name ?? "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Out {formatShopDate(c.checked_out_at)} · {daysOutLabel(days)}
                      {c.quantity_returned > 0 && (
                        <> · {formatQty(c.quantity_returned)} of {formatQty(c.quantity_out)} back</>
                      )}
                      {overdue && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">
                          Out {days} days
                        </Badge>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setCheckInId(c.id)}>
                      Check in
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => markUsed(c)}
                      disabled={pending}
                    >
                      Used up
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        </Card>
      )}

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
            {transactions.map((tx) => (
              <ActivityRow key={tx.id} tx={tx} />
            ))}
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
        />
      )}
      {checkOutOpen && (
        <CheckOutDialog
          open
          onOpenChange={setCheckOutOpen}
          items={[item]}
          fixedItemId={item.id}
          projects={projects}
          employees={employees}
        />
      )}
      {checkInId !== null && (
        <CheckInDialog
          key={checkInId || "pick"}
          open
          onOpenChange={(open) => !open && setCheckInId(null)}
          checkouts={openCheckouts}
          employees={employees}
          itemId={item.id}
          initialCheckoutId={checkInId || undefined}
        />
      )}
    </div>
  );
}

function ActivityRow({ tx }: { tx: WarehouseTransaction }) {
  const meta = TRANSACTION_TYPE_META[tx.type];
  const positive = tx.quantity_change > 0;
  const isCheckIn = tx.type === "return" && !!tx.checkout_id;

  let label = meta.label;
  let badgeClass = meta.badgeClass;
  let headline: React.ReactNode = tx.notes || "—";
  if (tx.is_checkout) {
    label = "Checked out";
    badgeClass = CHECKOUT_BADGE;
    headline = <>Taken by {tx.employee_name ?? "Unknown"}</>;
  } else if (isCheckIn) {
    label = "Checked in";
    badgeClass = CHECKIN_BADGE;
    headline = <>Returned by {tx.employee_name ?? "Unknown"}</>;
  } else if (tx.order_id) {
    headline = (
      <Link href={`/warehouse/orders/${tx.order_id}`} className="hover:underline">
        {tx.notes || "Material order"}
      </Link>
    );
  }

  return (
    <div className="py-2.5 flex items-center gap-3">
      <Badge
        variant="outline"
        className={cn("text-[10px] shrink-0 w-24 justify-center", badgeClass)}
      >
        {label}
      </Badge>
      <div className="flex-1 min-w-0 text-sm">
        <p className="truncate">
          {headline}
          {tx.projects?.name && (
            <span className="text-muted-foreground"> · {tx.projects.name}</span>
          )}
        </p>
        {(tx.is_checkout || isCheckIn) && tx.notes && (
          <p className="text-xs text-muted-foreground truncate">{tx.notes}</p>
        )}
        {tx.is_checkout && tx.checkout_closed_at && (
          <p className="text-xs text-muted-foreground">
            {tx.checkout_close_reason === "used" ? "Rest used on the job" : "All back"} ·{" "}
            {formatShopDate(tx.checkout_closed_at)}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {tx.is_checkout || isCheckIn ? "Logged by " : ""}
          {tx.performed_by_name || "Unknown"} · {formatShopDateTime(tx.created_at)}
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
          {formatQty(tx.quantity_change)}
        </p>
        <p className="text-[10px] text-muted-foreground">→ {formatQty(tx.quantity_after)}</p>
      </div>
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
