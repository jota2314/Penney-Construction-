import { Badge } from "@/components/ui/badge";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
} from "@/lib/constants/project";
import type { ProjectStatus } from "@/types/database";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge variant="secondary" className={PROJECT_STATUS_COLORS[status]}>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}
