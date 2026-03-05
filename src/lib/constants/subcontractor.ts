import type { VettingStatus } from "@/types/database";

export const VETTING_STATUS_LABELS: Record<VettingStatus, string> = {
  prospect: "Prospect",
  references_received: "References Received",
  approved: "Approved",
};

export const VETTING_STATUS_COLORS: Record<VettingStatus, string> = {
  prospect: "bg-gray-100 text-gray-700",
  references_received: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
};

export const ALL_VETTING_STATUSES: VettingStatus[] = [
  "prospect",
  "references_received",
  "approved",
];

export const TRADE_OPTIONS = [
  "Carpentry",
  "Concrete",
  "Demolition",
  "Drywall",
  "Electrical",
  "Excavation",
  "Fencing",
  "Flooring",
  "Foundation",
  "Framing",
  "Garage Doors",
  "Gutters",
  "HVAC",
  "Insulation",
  "Landscaping",
  "Masonry",
  "Painting",
  "Plumbing",
  "Roofing",
  "Siding",
  "Stucco",
  "Tile",
  "Trim & Millwork",
  "Waterproofing",
  "Windows & Doors",
] as const;

export type Trade = (typeof TRADE_OPTIONS)[number];
