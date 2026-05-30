"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, X, Loader2, Activity } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { AGENTS, getAgent } from "@/lib/agents/registry";
import { AgentOffice } from "@/components/command-center/agent-office";
import {
  getAgentCrew,
  reviewSuggestion,
  type AgentStatus,
  type AgentRun,
  type AgentSuggestion,
} from "@/lib/actions/agents";

interface CrewData {
  statuses: AgentStatus[];
  recentRuns: AgentRun[];
  pending: AgentSuggestion[];
}

export function AgentCrew({ initial }: { initial: CrewData }) {
  const [data, setData] = useState<CrewData>(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const fresh = await getAgentCrew();
    setData(fresh);
  }, []);

  // Live: poll every 5s so the crew updates while you watch.
  useEffect(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const review = async (id: string, decision: "approved" | "dismissed") => {
    setBusy(id);
    await reviewSuggestion(id, decision);
    await refresh();
    setBusy(null);
  };

  return (
    <div className="space-y-6">
      {/* The crew — top-down office where each agent walks around */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          The Crew
        </h2>
        <AgentOffice agents={AGENTS} statuses={data.statuses} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Review queue */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Needs your review
            {data.pending.length > 0 && (
              <Badge variant="secondary">{data.pending.length}</Badge>
            )}
          </h2>
          {data.pending.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Nothing waiting. The crew will drop items here as they find them.
            </Card>
          ) : (
            <div className="space-y-2">
              {data.pending.map((s) => {
                const agent = getAgent(s.agent_key);
                return (
                  <Card key={s.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{agent?.emoji}</span>
                          <span>{agent?.name ?? s.agent_key}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {s.kind}
                          </Badge>
                        </div>
                        <p className="mt-1 font-medium text-foreground">
                          {s.title}
                        </p>
                        {s.detail && (
                          <p className="text-xs text-muted-foreground">
                            {s.detail}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-emerald-600"
                          disabled={busy === s.id}
                          onClick={() => review(s.id, "approved")}
                          aria-label="Approve"
                        >
                          {busy === s.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-rose-600"
                          disabled={busy === s.id}
                          onClick={() => review(s.id, "dismissed")}
                          aria-label="Dismiss"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Live activity feed */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Activity className="h-4 w-4" /> Live activity
          </h2>
          {data.recentRuns.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No shifts yet. Once your Routines run, every task shows up here
              live.
            </Card>
          ) : (
            <Card className="divide-y divide-border/50">
              {data.recentRuns.map((run) => {
                const agent = getAgent(run.agent_key);
                return (
                  <div
                    key={run.id}
                    className="flex items-center gap-3 px-3 py-2 text-sm"
                  >
                    <span className="text-lg">{agent?.emoji ?? "🤖"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-foreground">
                        {run.summary ||
                          `${agent?.name ?? run.agent_key} ran`}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDate(run.started_at)} · {run.items_found} found ·{" "}
                        {run.trigger}
                      </p>
                    </div>
                    {run.status === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
                    ) : run.status === "success" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <X className="h-4 w-4 text-rose-500" />
                    )}
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
