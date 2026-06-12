"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, PackageCheck, Truck, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDate } from "@/lib/utils";
import { ORDER_PRIORITY_META, ORDER_STATUS_META } from "@/lib/constants/warehouse";
import {
  fulfillMaterialOrder,
  updateOrderStatus,
} from "@/lib/actions/warehouse";
import type { MaterialOrderWithItems } from "@/types/database";

interface MaterialOrderDetailProps {
  order: MaterialOrderWithItems;
  stockById: Record<
    string,
    { quantity_on_hand: number; location: string | null; unit: string }
  >;
}

export function MaterialOrderDetail({ order, stockById }: MaterialOrderDetailProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // Pick quantities keyed by order line id; default to requested qty capped at stock.
  const [pickQty, setPickQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      order.material_order_items.map((l) => {
        const stock = l.item_id ? stockById[l.item_id] : null;
        const def = stock ? Math.min(l.quantity, stock.quantity_on_hand) : l.quantity;
        return [l.id, String(def)];
      })
    )
  );

  const statusMeta = ORDER_STATUS_META[order.status];
  const priorityMeta = ORDER_PRIORITY_META[order.priority];
  const canFulfill = ["pending", "approved"].includes(order.status);

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const handleFulfill = () =>
    run(() =>
      fulfillMaterialOrder(
        order.id,
        order.material_order_items.map((l) => ({
          orderItemId: l.id,
          itemId: l.item_id,
          quantity: parseFloat(pickQty[l.id] || "0") || 0,
        }))
      )
    );

  return (
    <div className="flex flex-col gap-4 sm:gap-6 max-w-3xl">
      {/* Order header */}
      <Card className="p-5">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold">{order.order_number}</h2>
          <Badge variant="outline" className={cn("text-[10px]", statusMeta.badgeClass)}>
            {statusMeta.label}
          </Badge>
          {order.priority !== "normal" && (
            <Badge variant="outline" className={cn("text-[10px]", priorityMeta.badgeClass)}>
              {priorityMeta.label}
            </Badge>
          )}
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm mt-4">
          <Field label="Requested by" value={order.requested_by_name} />
          <Field label="Project" value={order.projects?.name ?? null} />
          <Field
            label="Needed by"
            value={order.needed_by ? formatDate(order.needed_by, "long") : null}
          />
          <Field
            label="Delivery"
            value={order.delivery_method === "deliver_to_site" ? "Deliver to site" : "Pickup at warehouse"}
          />
          <Field label="Placed" value={formatDate(order.created_at, "long")} />
          <Field
            label="Fulfilled"
            value={order.fulfilled_at ? formatDate(order.fulfilled_at, "long") : null}
          />
        </dl>
        {order.notes && (
          <p className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">
            {order.notes}
          </p>
        )}
        {order.status === "rejected" && order.rejection_reason && (
          <p className="text-sm text-red-500 mt-3">
            Rejected: {order.rejection_reason}
          </p>
        )}
      </Card>

      {/* Line items */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">
          Items ({order.material_order_items.length})
        </h3>
        <div className="flex flex-col divide-y divide-border/50">
          {order.material_order_items.map((line) => {
            const stock = line.item_id ? stockById[line.item_id] : null;
            const short = stock != null && stock.quantity_on_hand < line.quantity;
            return (
              <div key={line.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{line.item_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.quantity} {line.unit} requested
                    {stock ? (
                      <span className={short ? "text-red-500" : "text-emerald-500"}>
                        {" "}
                        · {stock.quantity_on_hand} in stock
                        {stock.location && ` (${stock.location})`}
                      </span>
                    ) : line.item_id ? null : (
                      <span className="text-amber-500"> · not in catalog — buy out</span>
                    )}
                    {line.notes && <> · {line.notes}</>}
                  </p>
                </div>
                {canFulfill ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      className="w-20 h-8 text-right"
                      value={pickQty[line.id] ?? ""}
                      onChange={(e) =>
                        setPickQty((prev) => ({ ...prev, [line.id]: e.target.value }))
                      }
                    />
                    <span className="text-xs text-muted-foreground w-8">
                      {line.unit}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm font-medium shrink-0">
                    {line.quantity_fulfilled > 0
                      ? `${line.quantity_fulfilled} ${line.unit} picked`
                      : "—"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {order.status === "pending" && (
          <>
            <Button
              onClick={() => run(() => updateOrderStatus(order.id, "approved"))}
              disabled={pending}
            >
              <Check className="h-4 w-4 mr-1" />
              Approve
            </Button>
            <Button
              variant="outline"
              className="text-red-500 hover:text-red-600"
              onClick={() => setRejecting((v) => !v)}
              disabled={pending}
            >
              <X className="h-4 w-4 mr-1" />
              Reject
            </Button>
          </>
        )}
        {canFulfill && (
          <Button onClick={handleFulfill} disabled={pending} variant={order.status === "approved" ? "default" : "outline"}>
            <PackageCheck className="h-4 w-4 mr-1" />
            {pending ? "Picking..." : "Mark Picked — Deduct Stock"}
          </Button>
        )}
        {order.status === "ready" && (
          <Button
            onClick={() => run(() => updateOrderStatus(order.id, "delivered"))}
            disabled={pending}
          >
            <Truck className="h-4 w-4 mr-1" />
            Mark {order.delivery_method === "deliver_to_site" ? "Delivered" : "Picked Up"}
          </Button>
        )}
        {["pending", "approved", "ready"].includes(order.status) && (
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              if (confirm("Cancel this order?"))
                run(() => updateOrderStatus(order.id, "cancelled"));
            }}
            disabled={pending}
          >
            Cancel Order
          </Button>
        )}
      </div>

      {rejecting && (
        <Card className="p-4 flex flex-col gap-3">
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
            placeholder="Why is this order being rejected? The crew will see this."
          />
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => updateOrderStatus(order.id, "rejected", rejectReason))
              }
            >
              Confirm Reject
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRejecting(false)}>
              Never mind
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}
