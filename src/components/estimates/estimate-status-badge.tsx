import { Badge } from "@/components/ui/badge";
import {
  ESTIMATE_STATUS_LABELS,
  ESTIMATE_STATUS_COLORS,
} from "@/lib/constants/estimate";
import type { EstimateStatus } from "@/types/database";

export function EstimateStatusBadge({ status }: { status: EstimateStatus }) {
  return (
    <Badge variant="secondary" className={ESTIMATE_STATUS_COLORS[status]}>
      {ESTIMATE_STATUS_LABELS[status]}
    </Badge>
  );
}
