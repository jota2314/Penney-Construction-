"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
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
import { Plus, Trash2, ChevronUp, ChevronDown, Sparkles, DollarSign, Loader2, GripVertical, Mail, ArrowUpToLine, ArrowDownToLine, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  addLineItem,
  updateLineItem,
  deleteLineItem,
  reorderLineItems,
  insertLineItemAt,
  toggleLineItemAllowance,
  setLineItemSection,
} from "@/lib/actions/estimates";
import { LineItemRefineDialog } from "./line-item-refine-dialog";
import { formatCurrency } from "@/lib/utils";
import type { EstimateLineItem } from "@/types/database";

interface ProjectContext {
  projectType: string;
  projectName: string;
  projectAddress?: string;
  projectOverview?: string;
}

interface TradeRateForAI {
  trade_name: string;
  unit_type: string;
  avg_cost: number;
  avg_price: number;
}

interface LineItemsTableProps {
  estimateId: string;
  lineItems: EstimateLineItem[];
  projectContext?: ProjectContext;
  tradeRates?: TradeRateForAI[];
}

interface RowState {
  description: string;
  proposal_description: string;
  value: string;
  cost: string;
  markup: string;
  section: string;
}

function stateFromItem(item: EstimateLineItem): RowState {
  return {
    description: item.description,
    proposal_description: item.proposal_description ?? "",
    value: item.total_price != null ? String(item.total_price) : "",
    cost: item.total_cost != null ? String(item.total_cost) : "",
    markup: item.markup_percentage != null ? String(item.markup_percentage) : "",
    section: item.section ?? "",
  };
}

/**
 * Compute whether a section header should render immediately before this
 * row. Header shows when the row's section differs from the previous
 * row's — gives a free visual divider between, say, "Master Bath" and
 * "Common Bath" without needing dedicated header rows in the DB.
 */
function shouldShowSectionHeader(
  items: EstimateLineItem[],
  index: number
): { show: boolean; label: string | null } {
  const current = items[index].section || "";
  const prev = index > 0 ? items[index - 1].section || "" : "";
  if (current === prev) return { show: false, label: null };
  // Only render a header when the row actually has a section name; if a
  // row is unsectioned at the top, no header.
  if (!current) return { show: false, label: null };
  return { show: true, label: current };
}

export function LineItemsTable({
  estimateId,
  lineItems: serverLineItems,
  projectContext,
  tradeRates,
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

  // DOM refs to the Price inputs so we can live-update them when Cost/Markup change
  const priceInputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  const totalPrice = lineItems.reduce((sum, item) => sum + (item.total_price ?? 0), 0);
  const totalCost = lineItems.reduce((sum, item) => sum + (item.total_cost ?? 0), 0);
  const totalProfit = totalPrice - totalCost;

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
      const base = existing ?? (item ? stateFromItem(item) : { description: "", proposal_description: "", value: "", cost: "", markup: "", section: "" });
      localEdits.current.set(id, { ...base, [field]: value });
    },
    [lineItems]
  );

  // Recalculate Price from Cost × (1 + Markup/100) and push into the Price input imperatively.
  // Kept uncontrolled so we don't trigger a re-render on every keystroke.
  const recalcPrice = useCallback((id: string) => {
    const local = localEdits.current.get(id);
    if (!local) return;
    const costVal = parseFloat(local.cost) || 0;
    if (costVal <= 0) return; // allow manual Price entry when no cost is set
    const markupVal = parseFloat(local.markup) || 0;
    const newPrice = costVal * (1 + markupVal / 100);
    const formatted = newPrice.toFixed(2);
    localEdits.current.set(id, { ...local, value: formatted });
    const input = priceInputRefs.current.get(id);
    if (input) input.value = formatted;
  }, []);

  async function handleBlurSave(item: EstimateLineItem) {
    const local = localEdits.current.get(item.id);
    if (!local) return; // no edits

    const original = stateFromItem(item);
    const changed =
      local.description !== original.description ||
      local.proposal_description !== original.proposal_description ||
      local.value !== original.value ||
      local.cost !== original.cost ||
      local.markup !== original.markup;

    if (!changed) return;

    if (!local.description.trim()) return; // don't save empty item name

    setSavingIds((prev) => new Set(prev).add(item.id));
    setError(null);

    const costVal = parseFloat(local.cost) || 0;
    const markupVal = parseFloat(local.markup) || 0;
    const hasCostData = costVal > 0;

    const result = await updateLineItem(item.id, estimateId, {
      description: local.description.trim(),
      proposal_description: local.proposal_description.trim() || undefined,
      value: hasCostData ? costVal * (1 + markupVal / 100) : (parseFloat(local.value) || 0),
      cost: hasCostData ? costVal : undefined,
      markup: hasCostData ? markupVal : undefined,
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

  async function handleInsertAt(anchorId: string, position: "above" | "below") {
    setError(null);
    const result = await insertLineItemAt(estimateId, anchorId, position);
    if (result.error) setError(result.error);
  }

  async function handleToggleAllowance(item: EstimateLineItem) {
    setError(null);
    const result = await toggleLineItemAllowance(item.id, estimateId, !item.is_allowance);
    if (result.error) setError(result.error);
  }

  async function handleSaveSection(item: EstimateLineItem) {
    const local = localEdits.current.get(item.id);
    if (!local) return;
    const trimmed = local.section.trim();
    const original = item.section ?? "";
    if (trimmed === original) return;
    setError(null);
    const result = await setLineItemSection(item.id, estimateId, trimmed || null);
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
    const currentState = getLocalState(refineItem);
    localEdits.current.set(refineItem.id, {
      description: updated.itemName,
      proposal_description: updated.scope,
      value: String(updated.price),
      cost: currentState.cost,
      markup: currentState.markup,
      section: currentState.section,
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
          tradeRates: tradeRates || undefined,
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
          description: current.description,
          proposal_description: current.proposal_description,
          value: String(suggestion.price),
          cost: current.cost,
          markup: current.markup,
          section: current.section,
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
            const sectionHeader = shouldShowSectionHeader(lineItems, index);

            return (
              <React.Fragment key={item.id}>
              {sectionHeader.show && (
                <div className="rounded-md bg-amber-500/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-amber-500">
                  {sectionHeader.label}
                </div>
              )}
              <div
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
                className={`rounded-md border p-3 space-y-2 ${isSaving ? "opacity-60" : ""} ${isDragging ? "opacity-30" : ""} ${isDragOver && dragIndex !== null && dragIndex !== index ? "border-t-2 border-t-orange-500" : ""} ${item.is_allowance ? "bg-yellow-500/10 border-yellow-500/30" : ""}`}
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
                  <div className="flex items-center gap-0.5 flex-wrap justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleInsertAt(item.id, "above")}
                      disabled={isSaving}
                      title="Insert above"
                    >
                      <ArrowUpToLine className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleInsertAt(item.id, "below")}
                      disabled={isSaving}
                      title="Insert below"
                    >
                      <ArrowDownToLine className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-8 w-8 ${item.is_allowance ? "text-yellow-500" : ""}`}
                      onClick={() => handleToggleAllowance(item)}
                      disabled={isSaving}
                      title={item.is_allowance ? "Remove allowance" : "Mark as allowance"}
                    >
                      <Tag className="h-4 w-4" />
                    </Button>
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

                {/* Section */}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Section</label>
                  <Input
                    key={`section-${item.id}-${inKey}`}
                    defaultValue={local.section}
                    onChange={(e) => setLocalField(item.id, "section", e.target.value)}
                    onBlur={() => handleSaveSection(item)}
                    placeholder="e.g. Master Bath (optional)"
                    className="h-8 text-sm"
                    disabled={isSaving}
                  />
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

                {/* Cost / Markup / Price row */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Cost ($)</label>
                    <Input
                      key={`cost-${item.id}-${inKey}`}
                      type="number"
                      defaultValue={local.cost}
                      onChange={(e) => {
                        setLocalField(item.id, "cost", e.target.value);
                        recalcPrice(item.id);
                      }}
                      onBlur={() => handleBlurSave(item)}
                      placeholder="0.00"
                      className="text-right text-sm"
                      step="0.01"
                      min="0"
                      disabled={isSaving}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Markup %</label>
                    <Input
                      key={`markup-${item.id}-${inKey}`}
                      type="number"
                      defaultValue={local.markup}
                      onChange={(e) => {
                        setLocalField(item.id, "markup", e.target.value);
                        recalcPrice(item.id);
                      }}
                      onBlur={() => handleBlurSave(item)}
                      placeholder="0"
                      className="text-right text-sm"
                      step="1"
                      min="0"
                      disabled={isSaving}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Price ($)</label>
                    <Input
                      key={`price-${item.id}-${inKey}`}
                      ref={(el) => { priceInputRefs.current.set(item.id, el); }}
                      type="number"
                      defaultValue={local.value}
                      onChange={(e) => setLocalField(item.id, "value", e.target.value)}
                      onBlur={() => handleBlurSave(item)}
                      placeholder="0.00"
                      className="text-right text-sm"
                      step="0.01"
                      min="0"
                      disabled={isSaving}
                    />
                  </div>
                </div>
                {/* Profit indicator */}
                {(item.total_cost ?? 0) > 0 && (
                  <div className="flex justify-end">
                    <span className={`text-xs font-medium ${(item.total_price ?? 0) - (item.total_cost ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                      Profit: {formatCurrency((item.total_price ?? 0) - (item.total_cost ?? 0))}
                    </span>
                  </div>
                )}
              </div>
              </React.Fragment>
            );
          })}

          {/* Mobile total bar */}
          {lineItems.length > 0 && (
            <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2">
              <span className="font-semibold text-sm">Total</span>
              <span className="font-bold">{formatCurrency(totalPrice, "two")}</span>
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
                <TableHead className="w-[180px]">Item</TableHead>
                <TableHead>Scope of Work</TableHead>
                <TableHead className="w-[110px] text-right">Cost ($)</TableHead>
                <TableHead className="w-[80px] text-right">Markup %</TableHead>
                <TableHead className="w-[110px] text-right">Price ($)</TableHead>
                <TableHead className="w-[90px] text-right">Profit</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
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
                const sectionHeader = shouldShowSectionHeader(lineItems, index);

                return (
                  <React.Fragment key={item.id}>
                  {sectionHeader.show && (
                    <TableRow className="bg-amber-500/10 hover:bg-amber-500/10">
                      <TableCell colSpan={8} className="py-1.5 px-3 text-xs font-bold uppercase tracking-wide text-amber-500 whitespace-normal">
                        {sectionHeader.label}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow
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
                    className={`${isSaving ? "opacity-60" : ""} ${isDragging ? "opacity-30" : ""} ${isDragOver && dragIndex !== null && dragIndex !== index ? "border-t-2 border-t-orange-500" : ""} ${item.is_allowance ? "bg-yellow-500/10" : ""}`}
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
                      <Input
                        key={`section-${item.id}-${inKey}`}
                        defaultValue={local.section}
                        onChange={(e) => setLocalField(item.id, "section", e.target.value)}
                        onBlur={() => handleSaveSection(item)}
                        placeholder="Section (e.g. Master Bath)"
                        className="h-6 mt-1 text-[11px] px-2 placeholder:text-muted-foreground/50"
                        disabled={isSaving}
                      />
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {item.trade && (
                          <Badge variant="secondary" className="text-[8px] py-0 h-4">{item.trade}</Badge>
                        )}
                        {item.needs_sub_quote && (
                          <Badge className="text-[8px] py-0 h-4 bg-amber-500/15 text-amber-500 border-amber-500/30 gap-0.5">
                            <Mail className="h-2.5 w-2.5" /> Need Quote
                          </Badge>
                        )}
                        {item.is_allowance && (
                          <Badge className="text-[8px] py-0 h-4 bg-yellow-500/20 text-yellow-500 border-yellow-500/40">
                            ALLOWANCE
                          </Badge>
                        )}
                        {item.source === "takeoff" && (
                          <Badge variant="outline" className="text-[8px] py-0 h-4 text-blue-400 border-blue-400/30">takeoff</Badge>
                        )}
                      </div>
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
                        key={`cost-${item.id}-${inKey}`}
                        type="number"
                        defaultValue={local.cost}
                        onChange={(e) => {
                          setLocalField(item.id, "cost", e.target.value);
                          recalcPrice(item.id);
                        }}
                        onBlur={() => handleBlurSave(item)}
                        placeholder="0.00"
                        className="h-8 text-right text-xs"
                        step="0.01"
                        min="0"
                        disabled={isSaving}
                      />
                    </TableCell>
                    <TableCell className="p-1.5">
                      <Input
                        key={`markup-${item.id}-${inKey}`}
                        type="number"
                        defaultValue={local.markup}
                        onChange={(e) => {
                          setLocalField(item.id, "markup", e.target.value);
                          recalcPrice(item.id);
                        }}
                        onBlur={() => handleBlurSave(item)}
                        placeholder="0"
                        className="h-8 text-right text-xs"
                        step="1"
                        min="0"
                        disabled={isSaving}
                      />
                    </TableCell>
                    <TableCell className="p-1.5">
                      <Input
                        key={`price-${item.id}-${inKey}`}
                        ref={(el) => { priceInputRefs.current.set(item.id, el); }}
                        type="number"
                        defaultValue={local.value}
                        onChange={(e) =>
                          setLocalField(item.id, "value", e.target.value)
                        }
                        onBlur={() => handleBlurSave(item)}
                        placeholder="0.00"
                        className="h-8 text-right text-xs"
                        step="0.01"
                        min="0"
                        disabled={isSaving}
                      />
                    </TableCell>
                    <TableCell className="p-1.5 text-right">
                      {(() => {
                        const c = item.total_cost ?? 0;
                        const p = item.total_price ?? 0;
                        const profit = p - c;
                        if (c === 0 && p === 0) return <span className="text-xs text-muted-foreground">—</span>;
                        return (
                          <span className={`text-xs font-medium tabular-nums ${profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {formatCurrency(profit)}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-0.5 flex-wrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleInsertAt(item.id, "above")}
                          disabled={isSaving}
                          title="Insert row above"
                        >
                          <ArrowUpToLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleInsertAt(item.id, "below")}
                          disabled={isSaving}
                          title="Insert row below"
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-7 w-7 ${item.is_allowance ? "text-yellow-500" : ""}`}
                          onClick={() => handleToggleAllowance(item)}
                          disabled={isSaving}
                          title={item.is_allowance ? "Remove allowance flag" : "Mark as allowance"}
                        >
                          <Tag className="h-3.5 w-3.5" />
                        </Button>
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
                  </React.Fragment>
                );
              })}
            </TableBody>
            {lineItems.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-bold text-xs">
                    {formatCurrency(totalCost, "two")}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {totalCost > 0 ? `${(((totalPrice - totalCost) / totalCost) * 100).toFixed(0)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-bold text-xs">
                    {formatCurrency(totalPrice, "two")}
                  </TableCell>
                  <TableCell className={`text-right font-bold text-xs ${totalProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatCurrency(totalProfit, "two")}
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
