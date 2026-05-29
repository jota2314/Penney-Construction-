"use server";

/**
 * Server actions for the Agent Crew dashboard. Reads the run log +
 * review queue the scheduled Claude Code Routines write to, and lets a
 * human approve/dismiss what the agents surface.
 */

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface AgentStatus {
  agent_key: string;
  total_runs: number;
  last_run_at: string | null;
  last_status: "running" | "success" | "error" | null;
  lifetime_items: number;
}

export interface AgentRun {
  id: string;
  agent_key: string;
  status: "running" | "success" | "error";
  trigger: string;
  started_at: string;
  finished_at: string | null;
  items_found: number;
  summary: string | null;
}

export interface AgentSuggestion {
  id: string;
  agent_key: string;
  project_id: string | null;
  kind: string;
  title: string;
  detail: string | null;
  status: "pending" | "approved" | "dismissed";
  created_at: string;
}

/** Per-agent status cards + recent activity feed + pending review queue. */
export async function getAgentCrew(): Promise<{
  statuses: AgentStatus[];
  recentRuns: AgentRun[];
  pending: AgentSuggestion[];
}> {
  const supabase = await createClient();

  const [{ data: statuses }, { data: recentRuns }, { data: pending }] =
    await Promise.all([
      supabase.from("agent_crew_status").select("*"),
      supabase
        .from("agent_runs")
        .select(
          "id, agent_key, status, trigger, started_at, finished_at, items_found, summary"
        )
        .order("started_at", { ascending: false })
        .limit(25),
      supabase
        .from("agent_suggestions")
        .select("id, agent_key, project_id, kind, title, detail, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  return {
    statuses: (statuses as AgentStatus[]) || [],
    recentRuns: (recentRuns as AgentRun[]) || [],
    pending: (pending as AgentSuggestion[]) || [],
  };
}

/** Approve or dismiss a suggestion the crew surfaced. */
export async function reviewSuggestion(
  id: string,
  decision: "approved" | "dismissed"
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("agent_suggestions")
    .update({
      status: decision,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/command-center/agents");
  return {};
}
