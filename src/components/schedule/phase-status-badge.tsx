import { Badge } from "@/components/ui/badge";
import {
  PHASE_STATUS_LABELS,
  PHASE_STATUS_COLORS,
} from "@/lib/constants/schedule";
import type { SchedulePhaseStatus } from "@/types/database";

export function PhaseStatusBadge({ status }: { status: SchedulePhaseStatus }) {
  return (
    <Badge variant="secondary" className={PHASE_STATUS_COLORS[status]}>
      {PHASE_STATUS_LABELS[status]}
    </Badge>
  );
}
