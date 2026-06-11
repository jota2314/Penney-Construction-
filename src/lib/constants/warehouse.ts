import type {
  MaterialOrderPriority,
  MaterialOrderStatus,
  WarehouseTransactionType,
} from "@/types/database";

export const WAREHOUSE_CATEGORIES: { value: string; label: string }[] = [
  { value: "lumber", label: "Lumber" },
  { value: "drywall", label: "Drywall" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "hvac", label: "HVAC" },
  { value: "hardware", label: "Hardware & Fasteners" },
  { value: "paint", label: "Paint & Finishes" },
  { value: "insulation", label: "Insulation" },
  { value: "tools", label: "Tools & Equipment" },
  { value: "safety", label: "Safety Gear" },
  { value: "other", label: "Other" },
];

export function categoryLabel(value: string): string {
  return WAREHOUSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export const WAREHOUSE_UNITS = [
  "each",
  "box",
  "bag",
  "bundle",
  "case",
  "roll",
  "sheet",
  "pair",
  "gallon",
  "lf",
  "sf",
] as const;

export const ORDER_STATUS_META: Record<
  MaterialOrderStatus,
  { label: string; badgeClass: string }
> = {
  pending: {
    label: "Pending Review",
    badgeClass: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  approved: {
    label: "Approved — Picking",
    badgeClass: "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  ready: {
    label: "Ready for Pickup",
    badgeClass: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  delivered: {
    label: "Delivered",
    badgeClass: "bg-muted text-muted-foreground border-border",
  },
  rejected: {
    label: "Rejected",
    badgeClass: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30",
  },
  cancelled: {
    label: "Cancelled",
    badgeClass: "bg-muted text-muted-foreground border-border",
  },
};

export const ORDER_PRIORITY_META: Record<
  MaterialOrderPriority,
  { label: string; badgeClass: string }
> = {
  low: { label: "Low", badgeClass: "bg-muted text-muted-foreground border-border" },
  normal: {
    label: "Normal",
    badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  high: {
    label: "High",
    badgeClass: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  },
  urgent: {
    label: "URGENT",
    badgeClass: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30",
  },
};

export const TRANSACTION_TYPE_META: Record<
  WarehouseTransactionType,
  { label: string; badgeClass: string }
> = {
  receive: {
    label: "Received",
    badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  issue: {
    label: "Issued",
    badgeClass: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  },
  return: {
    label: "Returned",
    badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  adjust: {
    label: "Adjusted",
    badgeClass: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  },
  order_fulfillment: {
    label: "Order Pick",
    badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
};
