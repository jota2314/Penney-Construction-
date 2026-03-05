import { Badge } from "@/components/ui/badge";
import {
  VETTING_STATUS_LABELS,
  VETTING_STATUS_COLORS,
} from "@/lib/constants/subcontractor";
import type { VettingStatus } from "@/types/database";

export function VettingStatusBadge({ status }: { status: VettingStatus }) {
  return (
    <Badge variant="secondary" className={VETTING_STATUS_COLORS[status]}>
      {VETTING_STATUS_LABELS[status]}
    </Badge>
  );
}
