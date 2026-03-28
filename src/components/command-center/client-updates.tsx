"use client";

import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import type { ClientUpdate } from "@/types/database";

interface ClientUpdatesProps {
  updates: ClientUpdate[];
}

export function ClientUpdates({ updates }: ClientUpdatesProps) {
  const sent = updates.filter((u) => u.status === "sent").length;
  const total = updates.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Weekly Client Updates</h3>
        {total > 0 && (
          <Badge
            variant="outline"
            className={`text-xs font-bold ${
              sent >= total
                ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                : "bg-orange-500/20 text-orange-400 border-orange-500/30"
            }`}
          >
            {sent}/{total} SENT
          </Badge>
        )}
      </div>

      {updates.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No client updates tracked this week.
        </div>
      ) : (
        <div className="space-y-2">
          {updates.map((update) => {
            const sentDay = update.sent_at
              ? new Date(update.sent_at).toLocaleDateString("en-US", {
                  weekday: "short",
                })
              : null;

            return (
              <div
                key={update.id}
                className="rounded-lg border bg-card p-4 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      update.status === "sent"
                        ? "bg-emerald-400"
                        : update.status === "skipped"
                        ? "bg-red-400"
                        : "bg-muted-foreground"
                    }`}
                  />
                  <span className="font-medium">{update.client_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {update.status === "sent" && (
                    <Check className="h-4 w-4 text-emerald-400" />
                  )}
                  <span className="text-sm text-muted-foreground">
                    {sentDay || "Pending"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
