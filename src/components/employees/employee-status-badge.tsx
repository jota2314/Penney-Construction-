import { Badge } from "@/components/ui/badge";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_COLORS,
} from "@/lib/constants/employee";
import type { EmployeeStatus } from "@/types/database";

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return (
    <Badge variant="secondary" className={EMPLOYEE_STATUS_COLORS[status]}>
      {EMPLOYEE_STATUS_LABELS[status]}
    </Badge>
  );
}
