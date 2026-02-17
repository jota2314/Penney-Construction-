import type { EstimateStatus } from "@/types/database";

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Draft",
  review: "In Review",
  approved: "Approved",
  superseded: "Superseded",
};

export const ESTIMATE_STATUS_COLORS: Record<EstimateStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  superseded: "bg-red-100 text-red-700",
};

export const ALL_ESTIMATE_STATUSES: EstimateStatus[] = [
  "draft",
  "review",
  "approved",
  "superseded",
];

export const ESTIMATE_TEMPLATES: Record<string, string[]> = {
  bathroom: [
    "Demolition",
    "Plumbing",
    "Electrical",
    "Drywall & Painting",
    "Tile & Flooring",
    "Fixtures",
    "Cabinetry & Vanity",
    "Shower/Tub",
    "Permits & Admin",
    "Cleanup",
  ],
  kitchen: [
    "Demolition",
    "Plumbing",
    "Electrical",
    "Cabinetry",
    "Countertops",
    "Backsplash & Tile",
    "Flooring",
    "Appliances",
    "Drywall & Painting",
    "Fixtures & Hardware",
    "Permits & Admin",
    "Cleanup",
  ],
  remodel: [
    "Demolition",
    "Framing & Structural",
    "Plumbing",
    "Electrical",
    "HVAC",
    "Drywall & Painting",
    "Flooring",
    "Finish Carpentry",
    "Permits & Admin",
    "Cleanup",
  ],
  addition: [
    "Site Work",
    "Foundation",
    "Framing",
    "Roofing",
    "Plumbing",
    "Electrical",
    "HVAC",
    "Insulation",
    "Drywall & Painting",
    "Flooring",
    "Finish Carpentry",
    "Permits & Admin",
    "Cleanup",
  ],
  new_construction: [
    "Site Work",
    "Foundation",
    "Framing",
    "Roofing",
    "Plumbing",
    "Electrical",
    "HVAC",
    "Insulation",
    "Drywall",
    "Painting",
    "Flooring",
    "Cabinetry",
    "Countertops",
    "Fixtures",
    "Finish Carpentry",
    "Landscaping",
    "Permits & Admin",
    "Cleanup",
  ],
  windows: [
    "Window Removal & Disposal",
    "Window Supply",
    "Window Installation",
    "Interior Trim & Casing",
    "Exterior Trim & Capping",
    "Painting & Touch-Up",
    "Cleanup",
    "Permits & Admin",
  ],
};

export const TEMPLATE_LABELS: Record<string, string> = {
  windows: "Windows Replacement",
};
