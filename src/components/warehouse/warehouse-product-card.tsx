"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Camera, MapPin, Truck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { categoryLabel } from "@/lib/constants/warehouse";
import { formatQty } from "@/lib/warehouse/checkouts";
import type { WarehouseItem } from "@/types/database";

interface WarehouseProductCardProps {
  item: WarehouseItem;
  photoUrl?: string;
  quantityOut: number;
  onReceive: () => void;
  onCheckOut: () => void;
}

export function WarehouseProductCard({ item, photoUrl, quantityOut, onReceive, onCheckOut }: WarehouseProductCardProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasPhoto = !!photoUrl && failedUrl !== photoUrl;
  const isReference = (item.photo_path ?? photoUrl)?.includes("/catalogref") ?? false;
  const empty = item.quantity_on_hand <= 0;
  const low = !empty && item.quantity_on_hand <= item.reorder_point;
  const href = `/warehouse/items/${item.id}`;

  return (
    <Card className="group h-full min-w-0 gap-0 overflow-hidden p-0 transition-colors hover:border-primary/60" data-warehouse-product>
      <div className="flex flex-1 flex-col">
        <Link href={href} tabIndex={-1} aria-hidden="true" className={cn("relative flex aspect-square items-center justify-center overflow-hidden border-b", hasPhoto ? "bg-white" : "bg-muted/40")}>
          {hasPhoto ? (
            // Product photos use signed storage URLs and must remain uncropped.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={item.name} loading="lazy" decoding="async" onError={() => setFailedUrl(photoUrl)} className="h-full w-full object-contain p-5 transition-transform duration-200 motion-safe:group-hover:scale-105 sm:p-6" />
          ) : (
            <div className="flex flex-col items-center gap-2 px-3 text-center text-muted-foreground">
              <Camera className="size-9 opacity-40 sm:size-11" aria-hidden="true" />
              <span className="text-xs font-medium">{item.photo_path ? "Photo unavailable" : "Photo needed"}</span>
              <span className="text-[11px]">{item.photo_path ? "Open item to view photo" : "Open item to add one"}</span>
            </div>
          )}
          {hasPhoto && isReference && <span className="absolute bottom-2 left-2 rounded bg-white/95 px-2 py-1 text-[10px] font-medium text-stone-600 shadow-sm">Reference photo</span>}
        </Link>

        <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-primary sm:text-[11px]">{categoryLabel(item.category)}</p>
          <h3 className="min-h-[3.75rem] text-sm font-semibold leading-5 text-foreground group-hover:text-primary"><Link href={href} className="line-clamp-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" title={item.name}>{item.name}</Link></h3>
          <p className="text-[11px] text-muted-foreground">SKU {item.sku}</p>
          {hasPhoto && isReference && <span className="sr-only">Catalog reference photo</span>}
          <div className="pt-1">
            <p className={cn("flex items-center gap-1.5 text-xs font-medium", empty ? "text-red-600 dark:text-red-400" : low ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
              <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
              {empty ? "Out of stock" : low ? "Low stock" : "In stock"}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-2xl font-bold tracking-tight tabular-nums">{formatQty(item.quantity_on_hand)}</span>
              <span className="text-xs text-muted-foreground">{item.unit} on shelf</span>
            </p>
          </div>
          <p className="flex min-h-8 items-start gap-1.5 text-[11px] leading-4 text-muted-foreground sm:text-xs" title={item.location || undefined}>
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="line-clamp-2">{item.location || "Shelf location needed"}</span>
          </p>
          {quantityOut > 0 && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Truck className="size-3.5 shrink-0" aria-hidden="true" />{formatQty(quantityOut)} out on jobs</p>}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-2 border-t bg-muted/20 p-3 sm:p-4">
        <Button className="h-11 w-full min-w-0 gap-1.5 px-2 text-xs has-[>svg]:px-2 sm:text-sm" onClick={onCheckOut} disabled={empty} aria-label={`Check out ${item.name}`}>
          <ArrowUpFromLine className="size-4" aria-hidden="true" />Check out
        </Button>
        <Button variant="outline" className="h-11 w-full min-w-0 gap-1.5 px-2 text-xs has-[>svg]:px-2 sm:text-sm" onClick={onReceive} aria-label={`Receive ${item.name}`}>
          <ArrowDownToLine className="size-4" aria-hidden="true" />Receive stock
        </Button>
      </div>
    </Card>
  );
}
