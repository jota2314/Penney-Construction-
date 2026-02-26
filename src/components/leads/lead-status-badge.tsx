import { Badge } from "@/components/ui/badge";
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
} from "@/lib/constants/lead";
import type { LeadStatus } from "@/types/database";

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge variant="secondary" className={LEAD_STATUS_COLORS[status]}>
      {LEAD_STATUS_LABELS[status]}
    </Badge>
  );
}
