"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, ChevronUp, ChevronDown, Sparkles, DollarSign, Loader2, GripVertical } from "lucide-react";
import {
  addLineItem,
  updateLineItem,
  deleteLineItem,
  reorderLineItems,
} from "@/lib/actions/estimates";
import { LineItemRefineDialog } from "./line-item-refine-dialog";
import type { EstimateLineItem } from "@/types/database";

interface ProjectContext {
  projectType: string;
  projectName: string;
  projectAddress?: string;
  projectOverview?: string;
}

interface LineItemsTableProps {
  estimateId: string;
  lineItems: EstimateLineItem[];
  projectContext?: ProjectContext;
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(val);

interface RowState {
  description: string;
  proposal_description: string;
  value: string;
}

function stateFromItem(item: EstimateLineItem): RowState {
  return {
    description: item.description,
    proposal_description: item.proposal_description ?? "",
    value: item.total_price ? String(item.total_price) : "",
  };
}

export function LineItemsTable({
  estimateId,
  lineItems: serverLineItems,
  projectContext,
}: LineItemsTableProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [textareaKeys, setTextareaKeys] = useState<Map<string, number>>(
    new Map()
  );
  const [inputKeys, setInputKeys] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [suggestingPrices, setSuggestingPrices] = useState(false);

  // Refine dialog state
  const [refineItem, setRefineItem] = useState<EstimateLineItem | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);

  // Optimistic local order for instant drag feedback (order only, content from server)
  const [localOrderIds, setLocalOrderIds] = useState<string[] | null>(null);
  const localOrder = localOrderIds
    ? localOrderIds
        .map((id) => serverLineItems.find((i) => i.id === id))
        .filter((i): i is EstimateLineItem => i != null)
    : null;
  const lineItems = localOrder ?? serverLineItems;

  // Clear local order when server catches up OR when items change (add/remove)
  useEffect(() => {
    if (!localOrderIds) return;
    const serverIdSet = new Set(serverLineItems.map((i) => i.id));
    // If items were added/removed, drop local order
    const sameSet = localOrderIds.length === serverIdSet.size &&
      localOrderIds.every((id) => serverIdSet.has(id));
    if (!sameSet) {
      setLocalOrderIds(null);
      return;
    }
    // If server order matches local, clear it
    const serverOrder = serverLineItems.map((i) => i.id).join(",");
    if (serverOrder === localOrderIds.join(",")) {
      setLocalOrderIds(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverLineItems]);

  // Drag and drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Track local edits per row so blur can compare & save
  const localEdits = useRef<Map<string, RowState>>(new Map());

  const total = lineItems.reduce((sum, item) => sum + (item.total_price ?? 0), 0);

  const getLocalState = useCallback(
    (item: EstimateLineItem): RowState => {
      return localEdits.current.get(item.id) ?? stateFromItem(item);
    },
    []
  );

  const setLocalField = useCallback(
    (id: string, field: keyof RowState, value: string) => {
      const existing = localEdits.current.get(id);
      const item = lineItems.find((i) => i.id === id);
      const base = existing ?? (item ? stateFromItem(item) : { description: "", proposal_description: "", value: "" });
      localEdits.current.set(id, { ...base, [field]: value });
    },
    [lineItems]
  );

  async function handleBlurSave(item: EstimateLineItem) {
    const local = localEdits.current.get(item.id);
    if (!local) return; // no edits

    const original = stateFromItem(item);
    const changed =
      local.description !== original.description ||
      local.proposal_description !== original.proposal_description ||
      local.value !== original.value;

    if (!changed) return;

    if (!local.description.trim()) return; // don't save empty item name

    setSavingIds((prev) => new Set(prev).add(item.id));
    setError(null);

    const result = await updateLineItem(item.id, estimateId, {
      description: local.description.trim(),
      proposal_description: local.proposal_description.trim() || undefined,
      value: parseFloat(local.value) || 0,
    });

    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });

    if (result.error) {
      setError(result.error);
    } else {
      localEdits.current.delete(item.id);
    }
  }

  async function handleAddRow() {
    setError(null);
    const result = await addLineItem(estimateId, {
      description: "",
      value: 0,
    });
    if (result.error) setError(result.error);
  }

  async function handleDelete(itemId: string) {
    localEdits.current.delete(itemId);
    const result = await deleteLineItem(itemId, estimateId);
    if (result.error) setError(result.error);
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const reordered = [...lineItems];
    [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
    setLocalOrderIds(reordered.map((i) => i.id));

    const updated = reordered.map((item, i) => ({ id: item.id, sort_order: i }));
    reorderLineItems(estimateId, updated);
  }

  function handleMoveDown(index: number) {
    if (index === lineItems.length - 1) return;
    const reordered = [...lineItems];
    [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
    setLocalOrderIds(reordered.map((i) => i.id));

    const updated = reordered.map((item, i) => ({ id: item.id, sort_order: i }));
    reorderLineItems(estimateId, updated);
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    // Build new order: move dragIndex item to targetIndex position
    const reordered = [...lineItems];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    // Optimistic update — instant visual feedback (store IDs only)
    setLocalOrderIds(reordered.map((item) => item.id));
    setDragIndex(null);
    setDragOverIndex(null);

    // Save in background — localOrderIds stays until server catches up
    const updated = reordered.map((item, i) => ({
      id: item.id,
      sort_order: i,
    }));
    reorderLineItems(estimateId, updated);
  }

  function handleRefineClick(item: EstimateLineItem) {
    setRefineItem(item);
    setRefineOpen(true);
  }

  async function handleRefineApply(updated: {
    itemName: string;
    scope: string;
    price: number;
  }) {
    if (!refineItem) return;

    // Update local state
    localEdits.current.set(refineItem.id, {
      description: updated.itemName,
      proposal_description: updated.scope,
      value: String(updated.price),
    });

    // Bump keys to force re-render of inputs
    setTextareaKeys((prev) => {
      const next = new Map(prev);
      next.set(refineItem.id, (next.get(refineItem.id) ?? 0) + 1);
      return next;
    });
    setInputKeys((prev) => {
      const next = new Map(prev);
      next.set(refineItem.id, (next.get(refineItem.id) ?? 0) + 1);
      return next;
    });

    // Save to DB
    setSavingIds((prev) => new Set(prev).add(refineItem.id));
    setError(null);

    const result = await updateLineItem(refineItem.id, estimateId, {
      description: updated.itemName.trim(),
      proposal_description: updated.scope.trim() || undefined,
      value: updated.price,
    });

    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(refineItem.id);
      return next;
    });

    if (result.error) {
      setError(result.error);
    } else {
      localEdits.current.delete(refineItem.id);
      router.refresh();
    }
  }

  async function handleSuggestPrices() {
    if (lineItems.length === 0) return;
    setSuggestingPrices(true);
    setError(null);

    try {
      const res = await fetch("/api/suggest-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItems: lineItems.map((item) => {
            const local = getLocalState(item);
            return {
              name: local.description,
              scope: local.proposal_description,
            };
          }),
          projectType: projectContext?.projectType,
          projectAddress: projectContext?.projectAddress,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to suggest prices");
      }

      const { prices } = await res.json();

      if (!Array.isArray(prices)) throw new Error("Invalid response");

      // Apply suggested prices to local state and save
      for (const suggestion of prices) {
        const item = lineItems[suggestion.index];
        if (!item || typeof suggestion.price !== "number") continue;

        // Only apply if current price is 0 or empty
        const current = getLocalState(item);
        const currentVal = parseFloat(current.value) || 0;
        if (currentVal > 0) continue; // don't overwrite existing prices

        localEdits.current.set(item.id, {
          ...current,
          value: String(suggestion.price),
        });

        // Bump input key to re-render
        setInputKeys((prev) => {
          const next = new Map(prev);
          next.set(item.id, (next.get(item.id) ?? 0) + 1);
          return next;
        });

        // Save to DB
        await updateLineItem(item.id, estimateId, {
          description: current.description.trim(),
          proposal_description: current.proposal_description.trim() || undefined,
          value: suggestion.price,
        });

        localEdits.current.delete(item.id);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to suggest prices");
    } finally {
      setSuggestingPrices(false);
    }
  }

  // Get refine item's current local state for the dialog
  const refineLocal = refineItem ? getLocalState(refineItem) : null;

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Mobile card layout */}
      {isMobile ? (
        <div className="space-y-3">
          {lineItems.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              No line items yet. Tap &quot;Add Row&quot; to get started.
            </p>
          )}

          {lineItems.map((item, index) => {
            const local = getLocalState(item);
            const isSaving = savingIds.has(item.id);
            const taKey = textareaKeys.get(item.id) ?? 0;
            const inKey = inputKeys.get(item.id) ?? 0;
            const isDragging = dragIndex === index;
            const isDragOver = dragOverIndex === index;

            return (
              <div
                key={item.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverIndex(index);
                }}
                onDragLeave={() => {
                  setDragOverIndex((prev) => (prev === index ? null : prev));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(index);
                }}
                className={`rounded-md border p-3 space-y-2 ${isSaving ? "opacity-60" : ""} ${isDragging ? "opacity-30" : ""} ${isDragOver && dragIndex !== null && dragIndex !== index ? "border-t-2 border-t-orange-500" : ""}`}
              >
                {/* Top bar: drag handle + index + actions */}
                <div className="flex items-center justify-between">
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(index);
                      e.dataTransfer.effectAllowed = "move";
                      const card = (e.target as HTMLElement).closest("[data-card]");
                      if (card) e.dataTransfer.setDragImage(card as HTMLElement, 0, 0);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className="text-xs font-medium text-muted-foreground flex items-center gap-1 cursor-grab active:cursor-grabbing"
                  >
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
                    #{index + 1}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRefineClick(item)}
                      disabled={isSaving}
                      title="Refine with AI"
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === 0 || isSaving}
                      onClick={() => handleMoveUp(index)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === lineItems.length - 1 || isSaving}
                      onClick={() => handleMoveDown(index)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleDelete(item.id)}
                      disabled={isSaving}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Item name */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Item</label>
                  <Input
                    key={`name-${item.id}-${inKey}`}
                    defaultValue={local.description}
                    onChange={(e) =>
                      setLocalField(item.id, "description", e.target.value)
                    }
                    onBlur={() => handleBlurSave(item)}
                    placeholder="Item name"
                    disabled={isSaving}
                  />
                </div>

                {/* Scope */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Scope of Work
                  </label>
                  <Textarea
                    key={`scope-${item.id}-${taKey}`}
                    defaultValue={local.proposal_description}
                    onChange={(e) =>
                      setLocalField(
                        item.id,
                        "proposal_description",
                        e.target.value
                      )
                    }
                    onBlur={() => handleBlurSave(item)}
                    placeholder="Describe the scope of work..."
                    className="resize-y text-sm"
                    rows={2}
                    disabled={isSaving}
                  />
                </div>

                {/* Value */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Value ($)
                  </label>
                  <Input
                    key={`price-${item.id}-${inKey}`}
                    type="number"
                    defaultValue={local.value}
                    onChange={(e) =>
                      setLocalField(item.id, "value", e.target.value)
                    }
                    onBlur={() => handleBlurSave(item)}
                    placeholder="0.00"
                    className="text-right"
                    step="0.01"
                    min="0"
                    disabled={isSaving}
                  />
                </div>
              </div>
            );
          })}

          {/* Mobile total bar */}
          {lineItems.length > 0 && (
            <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2">
              <span className="font-semibold text-sm">Total</span>
              <span className="font-bold">{formatCurrency(total)}</span>
            </div>
          )}
        </div>
      ) : (
        /* Desktop table layout */
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px] text-center">#</TableHead>
                <TableHead className="w-[200px]">Item</TableHead>
                <TableHead>Scope of Work</TableHead>
                <TableHead className="w-[150px] text-right">Value ($)</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-8"
                  >
                    No line items yet. Click &quot;Add Row&quot; to get started.
                  </TableCell>
                </TableRow>
              )}

              {lineItems.map((item, index) => {
                const local = getLocalState(item);
                const isSaving = savingIds.has(item.id);
                const taKey = textareaKeys.get(item.id) ?? 0;
                const inKey = inputKeys.get(item.id) ?? 0;
                const isDragging = dragIndex === index;
                const isDragOver = dragOverIndex === index;

                return (
                  <TableRow
                    key={item.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverIndex(index);
                    }}
                    onDragLeave={() => {
                      setDragOverIndex((prev) => (prev === index ? null : prev));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(index);
                    }}
                    className={`${isSaving ? "opacity-60" : ""} ${isDragging ? "opacity-30" : ""} ${isDragOver && dragIndex !== null && dragIndex !== index ? "border-t-2 border-t-orange-500" : ""}`}
                  >
                    <TableCell className="text-center text-sm text-muted-foreground p-0">
                      <div
                        draggable
                        onDragStart={(e) => {
                          setDragIndex(index);
                          e.dataTransfer.effectAllowed = "move";
                          // Use the parent row as drag image
                          const row = (e.target as HTMLElement).closest("tr");
                          if (row) e.dataTransfer.setDragImage(row, 0, 0);
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        className="flex items-center justify-center gap-1 cursor-grab active:cursor-grabbing py-2 px-1"
                      >
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
                        {index + 1}
                      </div>
                    </TableCell>
                    <TableCell className="p-1.5">
                      <Input
                        key={`name-${item.id}-${inKey}`}
                        defaultValue={local.description}
                        onChange={(e) =>
                          setLocalField(item.id, "description", e.target.value)
                        }
                        onBlur={() => handleBlurSave(item)}
                        placeholder="Item name"
                        className="h-8"
                        disabled={isSaving}
                      />
                    </TableCell>
                    <TableCell className="p-1.5">
                      <Textarea
                        key={`scope-${item.id}-${taKey}`}
                        defaultValue={local.proposal_description}
                        onChange={(e) =>
                          setLocalField(
                            item.id,
                            "proposal_description",
                            e.target.value
                          )
                        }
                        onBlur={() => handleBlurSave(item)}
                        placeholder="Describe the scope of work..."
                        className="min-h-[34px] resize-y text-sm"
                        rows={1}
                        disabled={isSaving}
                      />
                    </TableCell>
                    <TableCell className="p-1.5">
                      <Input
                        key={`price-${item.id}-${inKey}`}
                        type="number"
                        defaultValue={local.value}
                        onChange={(e) =>
                          setLocalField(item.id, "value", e.target.value)
                        }
                        onBlur={() => handleBlurSave(item)}
                        placeholder="0.00"
                        className="h-8 text-right"
                        step="0.01"
                        min="0"
                        disabled={isSaving}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleRefineClick(item)}
                          disabled={isSaving}
                          title="Refine with AI"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDelete(item.id)}
                          disabled={isSaving}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={index === 0 || isSaving}
                          onClick={() => handleMoveUp(index)}
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={index === lineItems.length - 1 || isSaving}
                          onClick={() => handleMoveDown(index)}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {lineItems.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatCurrency(total)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleAddRow}>
          <Plus className="mr-2 h-4 w-4" />
          Add Row
        </Button>
        {lineItems.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSuggestPrices}
            disabled={suggestingPrices}
          >
            {suggestingPrices ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <DollarSign className="mr-2 h-4 w-4" />
            )}
            {suggestingPrices ? "Suggesting..." : "Suggest Prices"}
          </Button>
        )}
      </div>

      {/* Per-item refine dialog */}
      {refineItem && refineLocal && (
        <LineItemRefineDialog
          open={refineOpen}
          onOpenChange={setRefineOpen}
          itemName={refineLocal.description}
          scope={refineLocal.proposal_description}
          price={parseFloat(refineLocal.value) || 0}
          projectType={projectContext?.projectType}
          projectAddress={projectContext?.projectAddress}
          onApply={handleRefineApply}
        />
      )}
    </div>
  );
}
