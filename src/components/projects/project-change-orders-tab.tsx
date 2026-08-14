"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plus,
  FileWarning,
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
  Loader2,
  Receipt,
  Send,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  createChangeOrder,
  updateChangeOrder,
  deleteChangeOrder,
  pushChangeOrderToQB,
} from "@/lib/actions/change-orders";

// ── Types ────────────────────────────────────────────

export interface ChangeOrderRow {
  id: string;
  project_id: string;
  change_order_number: number;
  title: string;
  description: string | null;
  status: string;
  cost_impact: number;
  price_impact: number;
  approved_at: string | null;
  sent_to_client_at: string | null;
  client_viewed_at: string | null;
  client_view_count: number | null;
  client_signature: string | null;
  client_signed_at: string | null;
  quickbooks_estimate_id?: string | null;
  quickbooks_pushed_at?: string | null;
}

interface ProjectChangeOrdersTabProps {
  projectId: string;
  changeOrders: ChangeOrderRow[];
  estimateId?: string | null;
}

const TRADE_OPTIONS = [
  "Administration",
  "Carpentry",
  "Concrete",
  "Demo",
  "Electrical",
  "Finish",
  "Framing",
  "HVAC",
  "Insulation",
  "Masonry",
  "Plumbing",
  "Roofing",
  "Siding",
  "Tile",
  "Windows",
  "Other",
];

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "void", label: "Void" },
];

function statusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
      return "bg-green-500/15 text-green-400 border-green-500/30";
    case "rejected":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "submitted":
    case "pending":
      return "bg-amber-500/15 text-amber-500 border-amber-500/30";
    case "void":
      return "bg-muted text-muted-foreground border-muted";
    default:
      return "";
  }
}

// ── Main Component ───────────────────────────────────

export function ProjectChangeOrdersTab({
  projectId,
  changeOrders: initialChangeOrders,
  estimateId,
}: ProjectChangeOrdersTabProps) {
  const [changeOrders, setChangeOrders] = useState(initialChangeOrders);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCO, setEditingCO] = useState<ChangeOrderRow | null>(null);
  const router = useRouter();

  const approvedCOs = changeOrders.filter((co) => co.status === "approved");
  const totalCostImpact = approvedCOs.reduce(
    (sum, co) => sum + Number(co.cost_impact),
    0
  );
  const totalPriceImpact = approvedCOs.reduce(
    (sum, co) => sum + Number(co.price_impact),
    0
  );

  function handleCreated() {
    setDialogOpen(false);
    setEditingCO(null);
    router.refresh();
  }

  function handleEdit(co: ChangeOrderRow) {
    setEditingCO(co);
    setDialogOpen(true);
  }

  function handleCloseDialog() {
    setDialogOpen(false);
    setEditingCO(null);
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-orange-500" />
            Change Orders
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track scope and budget changes throughout the project.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-orange-600 hover:bg-orange-700 text-white"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          New Change Order
        </Button>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Total COs
          </div>
          <div className="text-lg font-bold text-foreground mt-0.5">
            {changeOrders.length}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Approved
          </div>
          <div className="text-lg font-bold text-green-500 mt-0.5">
            {approvedCOs.length}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Cost Impact
          </div>
          <div className="text-lg font-bold text-red-500 mt-0.5">
            {formatCurrency(totalCostImpact)}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Price Impact
          </div>
          <div className="text-lg font-bold text-orange-500 mt-0.5">
            {formatCurrency(totalPriceImpact)}
          </div>
        </div>
      </div>

      {/* ── Change Order List ── */}
      {changeOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileWarning className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <h3 className="font-medium text-muted-foreground">
            No change orders yet
          </h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
            Change orders track scope and budget adjustments during
            construction. Create one to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {changeOrders.map((co) => {
            const isExpanded = expandedId === co.id;
            return (
              <ChangeOrderCard
                key={co.id}
                co={co}
                projectId={projectId}
                isExpanded={isExpanded}
                onToggle={() =>
                  setExpandedId(isExpanded ? null : co.id)
                }
                onEdit={() => handleEdit(co)}
                onDeleted={() => router.refresh()}
              />
            );
          })}
        </div>
      )}

      {/* ── Create/Edit Dialog ── */}
      {dialogOpen && (
        <ChangeOrderFormDialog
          projectId={projectId}
          estimateId={estimateId}
          editingCO={editingCO}
          onClose={handleCloseDialog}
          onSaved={handleCreated}
        />
      )}
    </div>
  );
}

// ── Change Order Card ────────────────────────────────

function ChangeOrderCard({
  co,
  projectId,
  isExpanded,
  onToggle,
  onEdit,
  onDeleted,
}: {
  co: ChangeOrderRow;
  projectId: string;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [qbPushing, setQbPushing] = useState(false);
  const [qbError, setQbError] = useState<string | null>(null);
  const [qbPushed, setQbPushed] = useState(Boolean(co.quickbooks_pushed_at));

  const canPushToQB =
    !qbPushed && (co.status === "approved" || Boolean(co.client_signed_at));

  async function handlePushToQB() {
    setQbPushing(true);
    setQbError(null);
    const result = await pushChangeOrderToQB(co.id, projectId);
    setQbPushing(false);
    if (result.error) {
      setQbError(result.error);
    } else {
      setQbPushed(true);
    }
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteChangeOrder(co.id, projectId);
      setConfirming(false);
      onDeleted();
    });
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header Row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-orange-600 dark:text-orange-400">
            #{co.change_order_number}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{co.title}</div>
          <div className="text-xs truncate flex items-center gap-2">
            {co.sent_to_client_at && (
              <span className="inline-flex items-center gap-1 text-green-500 font-medium">
                <Send className="h-3 w-3" />
                Sent{" "}
                {new Date(co.sent_to_client_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
            {co.approved_at && (
              <span className="text-muted-foreground">
                Approved{" "}
                {new Date(co.approved_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0 space-y-1">
          <div className="text-sm font-semibold text-orange-400">
            +{formatCurrency(Number(co.price_impact))}
          </div>
          <Badge
            variant={co.status === "draft" ? "outline" : "secondary"}
            className={`text-[9px] ${statusBadgeClass(co.status)}`}
          >
            {co.status}
          </Badge>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t space-y-3">
          {/* Details Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Our Cost:</span>{" "}
              <span className="font-medium">
                {formatCurrency(Number(co.cost_impact))}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Client Price:</span>{" "}
              <span className="font-medium text-orange-400">
                {formatCurrency(Number(co.price_impact))}
              </span>
            </div>
            {Number(co.cost_impact) > 0 && (
              <div>
                <span className="text-muted-foreground">Markup:</span>{" "}
                <span className="font-medium">
                  {Math.round(
                    ((Number(co.price_impact) / Number(co.cost_impact)) - 1) *
                      100
                  )}
                  %
                </span>
              </div>
            )}
          </div>

          {/* Description */}
          {co.description && (
            <div className="text-xs">
              <span className="text-muted-foreground">Description:</span>{" "}
              {co.description}
            </div>
          )}

          {/* Client tracking */}
          {(co.sent_to_client_at || co.client_viewed_at || co.client_signature) && (
            <div className="flex flex-wrap gap-2 text-xs">
              {co.sent_to_client_at && (
                <span className="text-green-500 font-medium">
                  Sent to client{" "}
                  {new Date(co.sent_to_client_at).toLocaleDateString()}
                </span>
              )}
              {co.client_viewed_at && !co.client_signature && (
                <span className="text-blue-400 font-medium">
                  Viewed
                  {co.client_view_count && co.client_view_count > 1
                    ? ` ${co.client_view_count}x`
                    : ""}
                </span>
              )}
              {co.client_signature && (
                <span className="text-green-400 font-medium">
                  Signed by {co.client_signature}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          {qbError && (
            <div className="text-[10px] text-red-400">{qbError}</div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onEdit}
            >
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
            {canPushToQB && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-green-500 border-green-500/40 hover:text-green-400"
                onClick={handlePushToQB}
                disabled={qbPushing}
              >
                {qbPushing ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Receipt className="h-3 w-3 mr-1" />
                )}
                Push to QB
              </Button>
            )}
            {qbPushed && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-500">
                <Receipt className="h-3 w-3" />
                In QB
              </span>
            )}
            {!confirming ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-red-500 hover:text-red-600 ml-auto"
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Delete
              </Button>
            ) : (
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-[10px] text-red-400">
                  Delete CO #{co.change_order_number}?
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 text-[10px] px-2"
                  onClick={handleDelete}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Yes"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] px-2"
                  onClick={() => setConfirming(false)}
                >
                  No
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create/Edit Dialog ───────────────────────────────

function ChangeOrderFormDialog({
  projectId,
  estimateId,
  editingCO,
  onClose,
  onSaved,
}: {
  projectId: string;
  estimateId?: string | null;
  editingCO: ChangeOrderRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(editingCO?.title ?? "");
  const [description, setDescription] = useState(
    editingCO?.description ?? ""
  );
  const [trade, setTrade] = useState("");
  const [costImpact, setCostImpact] = useState(
    editingCO ? String(editingCO.cost_impact) : ""
  );
  const [priceImpact, setPriceImpact] = useState(
    editingCO ? String(editingCO.price_impact) : ""
  );
  const [status, setStatus] = useState(editingCO?.status ?? "draft");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    setError(null);

    try {
      if (editingCO) {
        const result = await updateChangeOrder(editingCO.id, projectId, {
          title: title.trim(),
          description: description.trim(),
          trade: trade || undefined,
          cost_impact: Number(costImpact) || 0,
          price_impact: Number(priceImpact) || 0,
          status,
          notes: notes.trim(),
        });
        if (result.error) {
          setError(result.error);
          setSaving(false);
          return;
        }
      } else {
        const result = await createChangeOrder({
          project_id: projectId,
          estimate_id: estimateId,
          title: title.trim(),
          description: description.trim(),
          trade: trade || undefined,
          cost_impact: Number(costImpact) || 0,
          price_impact: Number(priceImpact) || 0,
          status,
          notes: notes.trim(),
        });
        if (result.error) {
          setError(result.error);
          setSaving(false);
          return;
        }
      }
      onSaved();
    } catch {
      setError("An unexpected error occurred.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg border shadow-lg max-w-lg w-full max-h-[90vh] overflow-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">
          {editingCO
            ? `Edit CO #${editingCO.change_order_number}`
            : "New Change Order"}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Title *
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Extra framing for header"
              className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed scope of the change..."
              rows={3}
              className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            />
          </div>

          {/* Trade + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Trade
              </label>
              <select
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              >
                <option value="">-- Select --</option>
                {TRADE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Cost + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Our Cost ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={costImpact}
                onChange={(e) => setCostImpact(e.target.value)}
                placeholder="0"
                className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Client Price ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={priceImpact}
                onChange={(e) => setPriceImpact(e.target.value)}
                placeholder="0"
                className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes..."
              rows={2}
              className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !title.trim()}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  {editingCO ? "Saving..." : "Creating..."}
                </>
              ) : editingCO ? (
                "Save Changes"
              ) : (
                "Create CO"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
