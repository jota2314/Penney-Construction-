"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, X, Clock, Loader2, Activity } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { AGENTS, getAgent, type AgentDef } from "@/lib/agents/registry";
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

const ACCENT: Record<string, string> = {
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  emerald:
    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  sky: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  violet:
    "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
};

/** A worker is "working" if their latest run is still running. */
function isWorking(status?: AgentStatus): boolean {
  return status?.last_status === "running";
}

function WorkerCard({
  agent,
  status,
}: {
  agent: AgentDef;
  status?: AgentStatus;
}) {
  const working = isWorking(status);
  const accent = ACCENT[agent.color] ?? ACCENT.amber;

  // Not-yet-built agents render as a muted "Coming soon" card with no metrics.
  if (!agent.live) {
    return (
      <Card className="relative overflow-hidden border border-border/50 bg-muted/20 p-4 opacity-60">
        <div className="flex items-start gap-3">
          <div className="text-4xl leading-none grayscale" aria-hidden>
            <span role="img" aria-label="construction worker">
              👷
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg grayscale">{agent.emoji}</span>
              <h3 className="truncate font-semibold text-muted-foreground">
                {agent.name}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">{agent.role}</p>
            <div className="mt-1">
              <Badge variant="outline" className="text-[10px]">
                Coming soon
              </Badge>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{agent.description}</p>
      </Card>
    );
  }

  let stateLabel = "Clocked out";
  if (working) stateLabel = "On the job…";
  else if (status?.last_status === "success") stateLabel = "Shift done";
  else if (status?.last_status === "error") stateLabel = "Needs help";

  return (
    <Card className={`relative overflow-hidden border p-4 ${accent}`}>
      <div className="flex items-start gap-3">
        {/* Animated worker */}
        <div
          className={`text-4xl leading-none ${
            working ? "animate-bounce" : ""
          }`}
          aria-hidden
        >
          <span role="img" aria-label="construction worker">
            👷
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">{agent.emoji}</span>
            <h3 className="truncate font-semibold text-foreground">
              {agent.name}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">{agent.role}</p>
          <div className="mt-1 flex items-center gap-1 text-xs">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                working
                  ? "animate-pulse bg-emerald-500"
                  : status?.last_status === "error"
                    ? "bg-rose-500"
                    : "bg-muted-foreground/40"
              }`}
            />
            <span className="font-medium text-foreground">{stateLabel}</span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{agent.description}</p>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" />
          {agent.schedule}
        </span>
        <span className="font-medium text-foreground">
          {status?.lifetime_items ?? 0} done
        </span>
      </div>
      {status?.last_run_at && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Last shift {formatDate(status.last_run_at)}
        </p>
      )}
    </Card>
  );
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

  const statusFor = (key: string) =>
    data.statuses.find((s) => s.agent_key === key);

  return (
    <div className="space-y-6">
      {/* The crew */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          The Crew
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {AGENTS.map((agent) => (
            <WorkerCard
              key={agent.key}
              agent={agent}
              status={statusFor(agent.key)}
            />
          ))}
        </div>
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
