"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Check } from "lucide-react";
import {
  ALL_SITE_VISIT_TYPES,
  SITE_VISIT_TYPE_LABELS,
  SITE_VISIT_TYPE_COLORS,
} from "@/lib/constants/site-visit";
import { updateSiteVisitType } from "@/lib/actions/site-visits";
import type { SiteVisitType } from "@/types/database";

interface SiteVisitTypeBadgeProps {
  type: SiteVisitType;
  siteVisitId?: string;
}

export function SiteVisitTypeBadge({ type, siteVisitId }: SiteVisitTypeBadgeProps) {
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(type);

  // Sync with server prop when it changes (e.g. after revalidation)
  useEffect(() => {
    setCurrent(type);
  }, [type]);

  // Read-only badge when no siteVisitId provided
  if (!siteVisitId) {
    return (
      <Badge variant="secondary" className={SITE_VISIT_TYPE_COLORS[type]}>
        {SITE_VISIT_TYPE_LABELS[type]}
      </Badge>
    );
  }

  function handleSelect(newType: SiteVisitType) {
    if (newType === current) return;
    setCurrent(newType);
    startTransition(async () => {
      const result = await updateSiteVisitType(siteVisitId!, newType);
      if (result.error) {
        setCurrent(type);
      }
    });
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={isPending}>
        <button
          type="button"
          className="inline-flex items-center focus:outline-none disabled:opacity-50"
        >
          <Badge variant="secondary" className={`${SITE_VISIT_TYPE_COLORS[current]} cursor-pointer`}>
            {SITE_VISIT_TYPE_LABELS[current]}
            <ChevronDown className="ml-1 h-3 w-3" />
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        {ALL_SITE_VISIT_TYPES.map((t) => (
          <DropdownMenuItem
            key={t}
            onClick={() => handleSelect(t)}
          >
            <span className={`inline-block h-2 w-2 rounded-full mr-2 ${SITE_VISIT_TYPE_COLORS[t]}`} />
            {SITE_VISIT_TYPE_LABELS[t]}
            {t === current && <Check className="ml-auto h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
