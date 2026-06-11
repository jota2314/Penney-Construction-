"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatDate } from "@/lib/utils";
import {
  ORDER_PRIORITY_META,
  ORDER_STATUS_META,
  WAREHOUSE_CATEGORIES,
  WAREHOUSE_UNITS,
} from "@/lib/constants/warehouse";
import { createMaterialOrder } from "@/lib/actions/warehouse";
import type {
  MaterialOrderDeliveryMethod,
  MaterialOrderPriority,
  MaterialOrderWithItems,
  WarehouseItem,
} from "@/types/database";

interface CrewMaterialsProps {
  items: WarehouseItem[];
  projects: { id: string; name: string; project_number: string }[];
  myOrders: MaterialOrderWithItems[];
}

interface CustomLine {
  name: string;
  quantity: number;
  unit: string;
}

export function CrewMaterials({ items, projects, myOrders }: CrewMaterialsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState("order");
  const [view, setView] = useState<"catalog" | "review">("catalog");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Cart: catalog item id → quantity
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customLines, setCustomLines] = useState<CustomLine[]>([]);
  const [customDraft, setCustomDraft] = useState<CustomLine>({
    name: "",
    quantity: 1,
    unit: "each",
  });

  // Order form
  const [projectId, setProjectId] = useState<string>("none");
  const [neededBy, setNeededBy] = useState("");
  const [priority, setPriority] = useState<MaterialOrderPriority>("normal");
  const [deliveryMethod, setDeliveryMethod] =
    useState<MaterialOrderDeliveryMethod>("pickup");
  const [notes, setNotes] = useState("");

  const itemsById = useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i])),
    [items]
  );

  const usedCategories = useMemo(() => {
    const present = new Set(items.map((i) => i.category));
    return WAREHOUSE_CATEGORIES.filter((c) => present.has(c.value));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (category && i.category !== category) return false;
      if (q && !i.name.toLowerCase().includes(q) && !i.sku.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [items, search, category]);

  const cartCount =
    Object.keys(cart).length + customLines.length;

  const setQty = (itemId: string, qty: number) => {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[itemId];
      else next[itemId] = qty;
      return next;
    });
  };

  const addCustomLine = () => {
    if (!customDraft.name.trim() || customDraft.quantity <= 0) return;
    setCustomLines((prev) => [...prev, { ...customDraft, name: customDraft.name.trim() }]);
    setCustomDraft({ name: "", quantity: 1, unit: "each" });
  };

  const resetOrder = () => {
    setCart({});
    setCustomLines([]);
    setProjectId("none");
    setNeededBy("");
    setPriority("normal");
    setDeliveryMethod("pickup");
    setNotes("");
    setView("catalog");
  };

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createMaterialOrder({
        projectId: projectId === "none" ? null : projectId,
        neededBy: neededBy || null,
        priority,
        deliveryMethod,
        notes,
        items: [
          ...Object.entries(cart).map(([itemId, quantity]) => ({
            itemId,
            name: itemsById[itemId]?.name ?? "Unknown item",
            quantity,
            unit: itemsById[itemId]?.unit ?? "each",
          })),
          ...customLines.map((l) => ({
            itemId: null,
            name: l.name,
            quantity: l.quantity,
            unit: l.unit,
          })),
        ],
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirmation(result.orderNumber ?? null);
      resetOrder();
      setTab("orders");
      router.refresh();
    });
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="w-full grid grid-cols-2">
        <TabsTrigger value="order">Order Materials</TabsTrigger>
        <TabsTrigger value="orders">My Orders ({myOrders.length})</TabsTrigger>
      </TabsList>

      {/* ── Order tab ─────────────────────────────────────── */}
      <TabsContent value="order" className="mt-4">
        {view === "catalog" ? (
          <div className="flex flex-col gap-3 pb-24">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the warehouse..."
                className="pl-9"
              />
            </div>

            {usedCategories.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
                <Chip
                  label="All"
                  active={category === null}
                  onClick={() => setCategory(null)}
                />
                {usedCategories.map((c) => (
                  <Chip
                    key={c.value}
                    label={c.label}
                    active={category === c.value}
                    onClick={() =>
                      setCategory(category === c.value ? null : c.value)
                    }
                  />
                ))}
              </div>
            )}

            {filtered.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">
                  {items.length === 0
                    ? "The warehouse catalog is empty. You can still order — go to Review and add what you need as custom items."
                    : "Nothing matches your search."}
                </p>
              </Card>
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.map((item) => {
                  const inCart = cart[item.id] ?? 0;
                  const out = item.quantity_on_hand <= 0;
                  return (
                    <Card key={item.id} className="p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className={out ? "text-red-500" : "text-emerald-500"}>
                            {out ? "Out of stock" : `${item.quantity_on_hand} ${item.unit} available`}
                          </span>
                        </p>
                      </div>
                      {inCart > 0 ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-9 w-9"
                            onClick={() => setQty(item.id, inCart - 1)}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="w-8 text-center font-semibold">
                            {inCart}
                          </span>
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-9 w-9"
                            onClick={() => setQty(item.id, inCart + 1)}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => setQty(item.id, 1)}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add
                        </Button>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Floating cart bar — sits above the bottom nav */}
            <div className="fixed bottom-20 left-0 right-0 px-4 z-20 pointer-events-none">
              <Button
                className="w-full h-12 shadow-lg pointer-events-auto"
                disabled={cartCount === 0 && items.length > 0}
                onClick={() => setView("review")}
              >
                <ShoppingCart className="h-5 w-5 mr-2" />
                {cartCount > 0
                  ? `Review Order (${cartCount} item${cartCount === 1 ? "" : "s"})`
                  : "Review Order"}
              </Button>
            </div>
          </div>
        ) : (
          /* ── Review & submit ─────────────────────────────── */
          <div className="flex flex-col gap-4 pb-8">
            <button
              type="button"
              onClick={() => setView("catalog")}
              className="flex items-center gap-1 text-sm text-muted-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to catalog
            </button>

            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-2">Your order</h3>
              {cartCount === 0 && (
                <p className="text-sm text-muted-foreground">
                  No items yet — add from the catalog or write in what you need below.
                </p>
              )}
              <div className="flex flex-col divide-y divide-border/50">
                {Object.entries(cart).map(([itemId, qty]) => {
                  const item = itemsById[itemId];
                  if (!item) return null;
                  return (
                    <div key={itemId} className="py-2 flex items-center gap-2">
                      <p className="flex-1 text-sm truncate">{item.name}</p>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={() => setQty(itemId, qty - 1)}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-10 text-center text-sm font-semibold">
                          {qty} {item.unit !== "each" ? item.unit : ""}
                        </span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={() => setQty(itemId, qty + 1)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {customLines.map((line, idx) => (
                  <div key={`custom-${idx}`} className="py-2 flex items-center gap-2">
                    <p className="flex-1 text-sm truncate">
                      {line.name}{" "}
                      <span className="text-xs text-amber-500">(write-in)</span>
                    </p>
                    <span className="text-sm font-semibold">
                      {line.quantity} {line.unit}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() =>
                        setCustomLines((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Write-in line */}
              <div className="mt-3 pt-3 border-t border-border/50">
                <Label className="text-xs text-muted-foreground">
                  Need something not listed?
                </Label>
                <div className="flex gap-2 mt-1.5">
                  <Input
                    value={customDraft.name}
                    onChange={(e) =>
                      setCustomDraft((d) => ({ ...d, name: e.target.value }))
                    }
                    placeholder="Item name"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min="1"
                    inputMode="decimal"
                    value={customDraft.quantity}
                    onChange={(e) =>
                      setCustomDraft((d) => ({
                        ...d,
                        quantity: parseFloat(e.target.value) || 1,
                      }))
                    }
                    className="w-16"
                  />
                  <Select
                    value={customDraft.unit}
                    onValueChange={(v) => setCustomDraft((d) => ({ ...d, unit: v }))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WAREHOUSE_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={addCustomLine}
                    disabled={!customDraft.name.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-4 grid gap-4">
              <div className="grid gap-1.5">
                <Label>Job site / project</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No specific project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="cm-needed">Needed by</Label>
                  <Input
                    id="cm-needed"
                    type="date"
                    value={neededBy}
                    onChange={(e) => setNeededBy(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Priority</Label>
                  <Select
                    value={priority}
                    onValueChange={(v) => setPriority(v as MaterialOrderPriority)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label>How do you want it?</Label>
                <Select
                  value={deliveryMethod}
                  onValueChange={(v) =>
                    setDeliveryMethod(v as MaterialOrderDeliveryMethod)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pickup">I&apos;ll pick up at the warehouse</SelectItem>
                    <SelectItem value="deliver_to_site">Deliver to the job site</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="cm-notes">Notes for the warehouse</Label>
                <Textarea
                  id="cm-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Optional — gate codes, where to drop it, etc."
                />
              </div>
            </Card>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <Button
              className="h-12"
              onClick={handleSubmit}
              disabled={pending || cartCount === 0}
            >
              {pending ? "Sending order..." : "Submit Order"}
            </Button>
          </div>
        )}
      </TabsContent>

      {/* ── My Orders tab ─────────────────────────────────── */}
      <TabsContent value="orders" className="mt-4">
        <div className="flex flex-col gap-3 pb-8">
          {confirmation && (
            <Card className="p-3 border-emerald-500/40 bg-emerald-500/10">
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                Order {confirmation} sent to the warehouse. You&apos;ll see status
                updates here.
              </p>
            </Card>
          )}
          {myOrders.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No orders yet. Order materials and they&apos;ll show up here.</p>
            </Card>
          ) : (
            myOrders.map((order) => {
              const statusMeta = ORDER_STATUS_META[order.status];
              const priorityMeta = ORDER_PRIORITY_META[order.priority];
              return (
                <Card key={order.id} className="p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{order.order_number}</span>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px]", statusMeta.badgeClass)}
                    >
                      {statusMeta.label}
                    </Badge>
                    {order.priority !== "normal" && (
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", priorityMeta.badgeClass)}
                      >
                        {priorityMeta.label}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {formatDate(order.created_at)}
                    </span>
                  </div>
                  <ul className="text-sm mt-2 text-muted-foreground">
                    {order.material_order_items.map((l) => (
                      <li key={l.id} className="truncate">
                        {l.quantity} {l.unit !== "each" ? `${l.unit} ` : "× "}
                        {l.item_name}
                      </li>
                    ))}
                  </ul>
                  {order.projects?.name && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      → {order.projects.name}
                    </p>
                  )}
                  {order.status === "rejected" && order.rejection_reason && (
                    <p className="text-xs text-red-500 mt-1.5">
                      {order.rejection_reason}
                    </p>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function Chip({
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
        "px-3 py-1 rounded-full text-xs border whitespace-nowrap transition-colors shrink-0",
        active
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40 font-medium"
          : "text-muted-foreground border-border"
      )}
    >
      {label}
    </button>
  );
}
