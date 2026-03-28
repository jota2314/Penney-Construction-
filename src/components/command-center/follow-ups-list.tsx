"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateFollowUpStatus } from "@/lib/actions/command-center";
import type { FollowUp } from "@/types/database";
import { useRouter } from "next/navigation";

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "subcontractor", label: "Subs" },
  { key: "client", label: "Clients" },
  { key: "internal", label: "Internal" },
] as const;

type TypeFilter = (typeof TYPE_FILTERS)[number]["key"];

interface FollowUpsListProps {
  followUps: FollowUp[];
}

export function FollowUpsList({ followUps }: FollowUpsListProps) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const open = followUps.filter((f) => f.status === "open");
  const done = followUps.filter((f) => f.status === "done");

  const filtered = typeFilter === "all"
    ? open
    : open.filter((f) => f.contact_type === typeFilter);

  const typeCounts: Record<string, number> = { all: open.length };
  open.forEach((f) => {
    typeCounts[f.contact_type] = (typeCounts[f.contact_type] || 0) + 1;
  });

  async function handleDone(id: string) {
    await updateFollowUpStatus(id, "done");
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Follow-ups</h3>
        <span className="text-sm text-muted-foreground">
          {filtered.length} open
        </span>
      </div>

      {/* Type filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            className={`rounded-full px-3 py-1 text-sm font-medium border transition-colors whitespace-nowrap ${
              typeFilter === f.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {f.label} ({typeCounts[f.key] || 0})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {typeFilter === "all"
            ? "All caught up! No open follow-ups."
            : `No ${typeFilter} follow-ups.`}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((followUp) => (
            <div
              key={followUp.id}
              className="rounded-lg border bg-card p-4 flex items-center justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{followUp.contact_name}</span>
                  {followUp.project_name && (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30"
                    >
                      {followUp.project_name.toUpperCase()}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      PRIORITY_COLORS[followUp.priority] ||
                      PRIORITY_COLORS.medium
                    }`}
                  >
                    {followUp.priority.toUpperCase()}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {followUp.description}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                >
                  Draft
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDone(followUp.id)}
                >
                  Done
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            Completed ({done.length})
          </h4>
          <div className="space-y-1">
            {done.slice(0, 5).map((followUp) => (
              <div
                key={followUp.id}
                className="rounded-lg border bg-card/50 p-3 flex items-center gap-3 opacity-60"
              >
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-sm line-through">
                  {followUp.contact_name} — {followUp.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
