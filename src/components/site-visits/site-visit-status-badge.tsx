import { Badge } from "@/components/ui/badge";
import {
  SITE_VISIT_STATUS_LABELS,
  SITE_VISIT_STATUS_COLORS,
} from "@/lib/constants/site-visit";
import type { SiteVisitStatus } from "@/types/database";

export function SiteVisitStatusBadge({ status }: { status: SiteVisitStatus }) {
  return (
    <Badge variant="secondary" className={SITE_VISIT_STATUS_COLORS[status]}>
      {SITE_VISIT_STATUS_LABELS[status]}
    </Badge>
  );
}
