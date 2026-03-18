"use client";

import { Badge } from "@/components/ui/badge";
import {
  WALKTHROUGH_STATUS_LABELS,
  WALKTHROUGH_STATUS_COLORS,
} from "@/lib/constants/walkthrough";
import type { WalkthroughStatus } from "@/types/database";

export function WalkthroughStatusBadge({
  status,
}: {
  status: WalkthroughStatus;
}) {
  return (
    <Badge
      variant="secondary"
      className={`text-[10px] ${WALKTHROUGH_STATUS_COLORS[status]}`}
    >
      {WALKTHROUGH_STATUS_LABELS[status]}
    </Badge>
  );
}
