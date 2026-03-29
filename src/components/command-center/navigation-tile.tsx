"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface NavigationTileProps {
  title: string;
  icon: LucideIcon;
  iconColorClass: string;
  metric: number | string;
  metricLabel: string;
  metricColorClass?: string;
  href?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  urgencyBadge?: {
    label: string;
    variant: "destructive" | "default";
    pulse?: boolean;
  };
  className?: string;
}

export function NavigationTile({
  title,
  icon: Icon,
  iconColorClass,
  metric,
  metricLabel,
  metricColorClass,
  href,
  onClick,
  children,
  urgencyBadge,
  className,
}: NavigationTileProps) {
  const card = (
    <Card className="relative h-full p-5 rounded-xl border transition-all duration-200 hover:border-amber-500/40 hover:shadow-md hover:-translate-y-0.5 cursor-pointer overflow-hidden">
      {/* Urgency pulse dot */}
      {urgencyBadge?.pulse && (
        <span className="absolute top-3 right-3 h-3 w-3 rounded-full bg-red-500 animate-pulse" />
      )}

      {/* Header: icon + title */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            iconColorClass
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
          {title}
        </span>
      </div>

      {/* Metric */}
      <div className="mb-2">
        <span className={cn("text-3xl font-bold", metricColorClass || "text-foreground")}>
          {metric}
        </span>
        <span className="text-xs text-muted-foreground uppercase tracking-wide ml-2">
          {metricLabel}
        </span>
      </div>

      {/* Secondary content (mini charts, badges, etc.) */}
      {children && <div className="mt-2">{children}</div>}

      {/* Urgency badge */}
      {urgencyBadge && (
        <div className="mt-2">
          <Badge variant={urgencyBadge.variant} className="text-[10px]">
            {urgencyBadge.label}
          </Badge>
        </div>
      )}
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className={cn("block group", className)}>
        {card}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("block group w-full text-left", className)}
    >
      {card}
    </button>
  );
}
