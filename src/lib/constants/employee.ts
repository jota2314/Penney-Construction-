import type { EmployeeStatus } from "@/types/database";

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

export const EMPLOYEE_STATUS_COLORS: Record<EmployeeStatus, string> = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-gray-100 text-gray-500",
};

export const ALL_EMPLOYEE_STATUSES: EmployeeStatus[] = ["active", "inactive"];

export const COMMON_TITLES = [
  "Superintendent",
  "Foreman",
  "Lead Carpenter",
  "Carpenter",
  "Apprentice",
  "Laborer",
  "Project Manager",
  "Estimator",
  "Office Manager",
] as const;
