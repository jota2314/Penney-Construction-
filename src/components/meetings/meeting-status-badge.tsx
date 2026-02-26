import { Badge } from "@/components/ui/badge";
import {
  MEETING_STATUS_LABELS,
  MEETING_STATUS_COLORS,
} from "@/lib/constants/meeting";
import type { MeetingStatus } from "@/types/database";

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  return (
    <Badge variant="secondary" className={MEETING_STATUS_COLORS[status]}>
      {MEETING_STATUS_LABELS[status]}
    </Badge>
  );
}
