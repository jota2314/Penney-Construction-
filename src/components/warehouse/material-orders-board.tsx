"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { ORDER_PRIORITY_META, ORDER_STATUS_META } from "@/lib/constants/warehouse";
import type { MaterialOrderWithItems } from "@/types/database";

interface MaterialOrdersBoardProps {
  orders: MaterialOrderWithItems[];
}

export function MaterialOrdersBoard({ orders }: MaterialOrdersBoardProps) {
  const groups = useMemo(() => {
    const pending = orders.filter((o) => o.status === "pending");
    const inProgress = orders.filter((o) =>
      ["approved", "ready"].includes(o.status)
    );
    const closed = orders
      .filter((o) => ["delivered", "rejected", "cancelled"].includes(o.status))
      .slice(0, 20);
    return { pending, inProgress, closed };
  }, [orders]);

  if (orders.length === 0) {
    return (
      <Card className="p-10 text-center text-muted-foreground">
        <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium text-foreground mb-1">No material orders yet</p>
        <p className="text-sm">
          When the field crew orders materials from their phones, the orders land
          here for review and picking.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <OrderSection
        title={`Needs Review (${groups.pending.length})`}
        orders={groups.pending}
        emptyText="Nothing waiting on review."
      />
      <OrderSection
        title={`In Progress (${groups.inProgress.length})`}
        orders={groups.inProgress}
        emptyText="Nothing being picked right now."
      />
      <OrderSection
        title="Recently Closed"
        orders={groups.closed}
        emptyText="No closed orders yet."
      />
    </div>
  );
}

function OrderSection({
  title,
  orders,
  emptyText,
}: {
  title: string;
  orders: MaterialOrderWithItems[];
  emptyText: string;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        {title}
      </h2>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </section>
  );
}

export function OrderCard({
  order,
  href,
}: {
  order: MaterialOrderWithItems;
  href?: string;
}) {
  const statusMeta = ORDER_STATUS_META[order.status];
  const priorityMeta = ORDER_PRIORITY_META[order.priority];
  const lineCount = order.material_order_items.length;
  const preview = order.material_order_items
    .slice(0, 3)
    .map((l) => `${l.quantity} ${l.unit !== "each" ? l.unit + " " : "× "}${l.item_name}`)
    .join(", ");

  const body = (
    <Card className="p-3 sm:p-4 hover:border-amber-500/40 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm">{order.order_number}</span>
        <Badge variant="outline" className={cn("text-[10px]", statusMeta.badgeClass)}>
          {statusMeta.label}
        </Badge>
        {order.priority !== "normal" && (
          <Badge variant="outline" className={cn("text-[10px]", priorityMeta.badgeClass)}>
            {priorityMeta.label}
          </Badge>
        )}
        {order.needed_by && (
          <span className="text-xs text-muted-foreground ml-auto">
            Needed {formatDate(order.needed_by)}
          </span>
        )}
      </div>
      <p className="text-sm mt-1.5 truncate">
        {preview}
        {lineCount > 3 && (
          <span className="text-muted-foreground"> +{lineCount - 3} more</span>
        )}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {order.requested_by_name || "Unknown"}
        {order.projects?.name && <> → {order.projects.name}</>}
        {" · "}
        {order.delivery_method === "deliver_to_site" ? "Deliver to site" : "Pickup"}
        {" · "}
        {formatDate(order.created_at)}
      </p>
      {order.status === "rejected" && order.rejection_reason && (
        <p className="text-xs text-red-500 mt-1">Reason: {order.rejection_reason}</p>
      )}
    </Card>
  );

  if (href === undefined) {
    return (
      <Link href={`/warehouse/orders/${order.id}`} className="block">
        {body}
      </Link>
    );
  }
  if (href === "") return body;
  return (
    <Link href={href} className="block">
      {body}
    </Link>
  );
}
