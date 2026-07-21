"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  X,
  Loader2,
  Activity,
  ChevronDown,
  FileText,
  Mail,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { AGENTS, getAgent } from "@/lib/agents/registry";
import { AgentOffice } from "@/components/command-center/agent-office";
import {
  getAgentCrew,
  reviewSuggestion,
  getSuggestionEvidence,
  getRunSuggestions,
  type AgentStatus,
  type AgentRun,
  type AgentSuggestion,
  type SuggestionEvidence,
} from "@/lib/actions/agents";

interface CrewData {
  statuses: AgentStatus[];
  recentRuns: AgentRun[];
  pending: AgentSuggestion[];
}

type RunSuggestionRow = { id: string; kind: string; title: string; status: string };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const RETURN_URL = encodeURIComponent("/command-center/agents");

function runDurationLabel(run: AgentRun): string | null {
  if (!run.finished_at) return null;
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  if (ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "under a minute";
  return `${mins} min`;
}

export function AgentCrew({ initial }: { initial: CrewData }) {
  const [data, setData] = useState<CrewData>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<{ id: string; message: string } | null>(null);

  // Review-card drill-down state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, SuggestionEvidence | null>>({});
  const [evidenceLoading, setEvidenceLoading] = useState<string | null>(null);
  const [linePick, setLinePick] = useState<Record<string, string>>({});

  // Activity drill-down state
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runSuggestions, setRunSuggestions] = useState<Record<string, RunSuggestionRow[]>>({});

  const refresh = useCallback(async () => {
    const fresh = await getAgentCrew();
    setData(fresh);
  }, []);

  // Live: poll every 5s so the crew updates while you watch.
  useEffect(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggleSuggestion = async (s: AgentSuggestion) => {
    if (expandedId === s.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(s.id);
    if (evidence[s.id] === undefined) {
      setEvidenceLoading(s.id);
      const ev = await getSuggestionEvidence(s.id);
      setEvidence((prev) => ({ ...prev, [s.id]: "error" in ev ? null : ev }));
      if (!("error" in ev) && ev.invoice?.assignedLineId) {
        setLinePick((prev) => ({ ...prev, [s.id]: ev.invoice!.assignedLineId! }));
      }
      setEvidenceLoading(null);
    }
  };

  const toggleRun = async (run: AgentRun) => {
    if (expandedRunId === run.id) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(run.id);
    if (runSuggestions[run.id] === undefined) {
      const rows = await getRunSuggestions(run.id);
      setRunSuggestions((prev) => ({ ...prev, [run.id]: rows }));
    }
  };

  const review = async (s: AgentSuggestion, decision: "approved" | "dismissed") => {
    setBusy(s.id);
    setReviewError(null);
    const picked = linePick[s.id];
    const result = await reviewSuggestion(
      s.id,
      decision,
      decision === "approved" && picked ? { estimateLineItemId: picked } : undefined
    );
    if (result.error) {
      setReviewError({ id: s.id, message: result.error });
    } else if (expandedId === s.id) {
      setExpandedId(null);
    }
    await refresh();
    setBusy(null);
  };

  /** What the green button will actually DO for this card — no mystery approves. */
  const approveLabel = (s: AgentSuggestion): string => {
    const ev = evidence[s.id];
    const isBill = s.kind === "invoice" || s.kind === "invoice_line";
    if (!isBill) return "Approve";
    const logged = !!ev?.invoice;
    const picked = linePick[s.id];
    if (logged) return picked ? "Assign line" : "Mark reviewed";
    const p = s.payload;
    if (p?.project_id && p?.vendor_name && p?.amount != null) return "Log bill";
    return "Mark reviewed";
  };

  const pendingCountByAgent = data.pending.reduce<Record<string, number>>((acc, s) => {
    acc[s.agent_key] = (acc[s.agent_key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* The crew — top-down office where each agent walks around */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          The Crew
        </h2>
        <AgentOffice
          agents={AGENTS}
          statuses={data.statuses}
          runs={data.recentRuns}
          pendingCounts={pendingCountByAgent}
        />
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
                const isExpanded = expandedId === s.id;
                const ev = evidence[s.id];
                const p = s.payload;
                return (
                  <Card key={s.id} className="overflow-hidden p-0">
                    {/* Header — tap anywhere to open the evidence */}
                    <button
                      type="button"
                      onClick={() => toggleSuggestion(s)}
                      className="flex w-full items-start justify-between gap-2 p-3 text-left hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{agent?.emoji}</span>
                          <span>{agent?.name ?? s.agent_key}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {s.kind}
                          </Badge>
                          <span className="text-[10px]">{formatDate(s.created_at)}</span>
                        </div>
                        <p className="mt-1 font-medium text-foreground">{s.title}</p>
                        {!isExpanded && s.detail && (
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {s.detail}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border/50 px-3 pb-3">
                        {s.detail && (
                          <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                            {s.detail}
                          </p>
                        )}

                        {evidenceLoading === s.id ? (
                          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Pulling up the paperwork…
                          </div>
                        ) : (
                          <>
                            {/* Facts off the document */}
                            {p && (
                              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                {p.amount != null && (
                                  <div>
                                    <span className="text-muted-foreground">Amount </span>
                                    <span className="font-semibold text-foreground">
                                      {usd.format(p.amount)}
                                    </span>
                                  </div>
                                )}
                                {p.vendor_name && (
                                  <div className="truncate">
                                    <span className="text-muted-foreground">Vendor </span>
                                    <span className="text-foreground">{p.vendor_name}</span>
                                  </div>
                                )}
                                {p.invoice_number && (
                                  <div>
                                    <span className="text-muted-foreground">Invoice # </span>
                                    <span className="text-foreground">{p.invoice_number}</span>
                                  </div>
                                )}
                                {p.invoice_date && (
                                  <div>
                                    <span className="text-muted-foreground">Dated </span>
                                    <span className="text-foreground">{p.invoice_date}</span>
                                  </div>
                                )}
                                {p.trade && (
                                  <div className="truncate">
                                    <span className="text-muted-foreground">Trade </span>
                                    <span className="text-foreground">{p.trade}</span>
                                  </div>
                                )}
                                {ev?.project && (
                                  <div className="truncate">
                                    <span className="text-muted-foreground">Job </span>
                                    <Link
                                      href={`/projects/${ev.project.id}`}
                                      className="font-medium text-amber-500 hover:underline"
                                    >
                                      {ev.project.name}
                                    </Link>
                                  </div>
                                )}
                              </div>
                            )}

                            {p?.note && (
                              <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-500">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                {p.note}
                              </p>
                            )}

                            {/* See it for yourself */}
                            <div className="mt-3 flex flex-wrap gap-2">
                              {ev?.attachment && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => window.open(ev.attachment!.url, "_blank")}
                                >
                                  <FileText className="mr-1 h-3.5 w-3.5" />
                                  View PDF
                                </Button>
                              )}
                              {ev?.email && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  asChild
                                >
                                  <Link
                                    href={`/command-center/email/${ev.email.id}?returnUrl=${RETURN_URL}`}
                                  >
                                    <Mail className="mr-1 h-3.5 w-3.5" />
                                    Open email
                                  </Link>
                                </Button>
                              )}
                              {ev?.project && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  asChild
                                >
                                  <Link href={`/projects/${ev.project.id}`}>
                                    <FolderOpen className="mr-1 h-3.5 w-3.5" />
                                    Open job
                                  </Link>
                                </Button>
                              )}
                            </div>

                            {/* Estimate-line assignment for bills */}
                            {ev && ev.estimateLines.length > 0 && (
                              <div className="mt-3">
                                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Assign to estimate line
                                </p>
                                <Select
                                  value={linePick[s.id] ?? ""}
                                  onValueChange={(v) =>
                                    setLinePick((prev) => ({ ...prev, [s.id]: v }))
                                  }
                                >
                                  <SelectTrigger className="h-8 w-full text-xs">
                                    <SelectValue placeholder="Pick the budget line this bill hits…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ev.estimateLines.map((l) => (
                                      <SelectItem key={l.id} value={l.id} className="text-xs">
                                        {[l.trade, l.description].filter(Boolean).join(" — ") ||
                                          "Untitled line"}
                                        {l.total_cost != null
                                          ? ` (${usd.format(l.total_cost)} budget)`
                                          : ""}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </>
                        )}

                        {reviewError?.id === s.id && (
                          <p className="mt-2 text-xs text-rose-500">{reviewError.message}</p>
                        )}

                        {/* The decision — says exactly what it will do */}
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            className="h-8 flex-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                            disabled={busy === s.id}
                            onClick={() => review(s, "approved")}
                          >
                            {busy === s.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                {approveLabel(s)}
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs text-rose-500 hover:text-rose-600"
                            disabled={busy === s.id}
                            onClick={() => review(s, "dismissed")}
                          >
                            <X className="mr-1 h-3.5 w-3.5" />
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    )}
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
                const isOpen = expandedRunId === run.id;
                const produced = runSuggestions[run.id];
                const duration = runDurationLabel(run);
                return (
                  <div key={run.id}>
                    <button
                      type="button"
                      onClick={() => toggleRun(run)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40"
                    >
                      <span className="text-lg">{agent?.emoji ?? "🤖"}</span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-foreground ${isOpen ? "" : "truncate"}`}>
                          {run.summary || `${agent?.name ?? run.agent_key} ran`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDate(run.started_at)} · {run.items_found} found ·{" "}
                          {run.trigger}
                        </p>
                      </div>
                      {run.status === "running" ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-500" />
                      ) : run.status === "success" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      ) : (
                        <X className="h-4 w-4 shrink-0 text-rose-500" />
                      )}
                    </button>

                    {isOpen && (
                      <div className="border-t border-border/30 bg-muted/20 px-3 py-2">
                        {run.summary && (
                          <p className="whitespace-pre-wrap text-xs text-foreground">
                            {run.summary}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {agent?.name ?? run.agent_key} · started{" "}
                          {formatDate(run.started_at)}
                          {duration ? ` · took ${duration}` : ""}
                          {run.status === "error" ? " · did not finish cleanly" : ""}
                        </p>

                        {produced === undefined ? (
                          <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Checking what this
                            shift produced…
                          </div>
                        ) : produced.length > 0 ? (
                          <div className="mt-2 space-y-1">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              What it turned in
                            </p>
                            {produced.map((rs) => (
                              <div
                                key={rs.id}
                                className="flex items-center gap-2 text-xs text-foreground"
                              >
                                <Badge variant="outline" className="text-[10px]">
                                  {rs.kind}
                                </Badge>
                                <span className="min-w-0 flex-1 truncate">{rs.title}</span>
                                <span
                                  className={`text-[10px] ${
                                    rs.status === "pending"
                                      ? "text-amber-500"
                                      : rs.status === "approved"
                                        ? "text-emerald-500"
                                        : "text-muted-foreground"
                                  }`}
                                >
                                  {rs.status === "pending" ? "waiting on you" : rs.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Nothing needed your review from this shift.
                          </p>
                        )}
                      </div>
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
