import type { UserRole } from "@/types/auth";

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  precon_manager: "Pre-Con Manager",
  project_manager: "Project Manager",
  office_admin: "Office Admin",
  field: "Field Crew",
};

export const ROLE_COLORS: Record<UserRole, string> = {
  owner: "bg-amber-100 text-amber-800",
  precon_manager: "bg-blue-100 text-blue-800",
  project_manager: "bg-green-100 text-green-800",
  office_admin: "bg-purple-100 text-purple-800",
  field: "bg-yellow-100 text-yellow-800",
};
