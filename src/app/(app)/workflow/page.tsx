import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { CreateWorkflowDialog } from "@/components/workflow/create-workflow-dialog";
import { WorkflowCard } from "@/components/workflow/workflow-card";
import { Badge } from "@/components/ui/badge";
import { WORKFLOW_STAGES } from "@/lib/constants/workflow";
import type { WorkflowInstance, Profile } from "@/types/database";

export const metadata: Metadata = { title: "Workflow Automation | Penney Construction" };

export default async function WorkflowPage() {
  await requireAuth();
  const supabase = await createClient();

  const [workflowsRes, profilesRes, countsRes] = await Promise.all([
    supabase
      .from("workflow_instances")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("*"),
    supabase
      .from("workflow_instances")
      .select("current_stage", { count: "exact", head: false })
      .eq("status", "active"),
  ]);

  const workflows = (workflowsRes.data || []) as WorkflowInstance[];
  const profiles = (profilesRes.data || []) as Profile[];

  // Count active workflows per stage
  const stageCounts: Record<string, number> = {};
  const activeWorkflows = (countsRes.data || []) as { current_stage: string }[];
  for (const w of activeWorkflows) {
    stageCounts[w.current_stage] = (stageCounts[w.current_stage] || 0) + 1;
  }

  const activeCount = workflows.filter((w) => w.status === "active").length;
  const completedCount = workflows.filter((w) => w.status === "completed").length;

  return (
    <>
      <Header title="Workflow Automation" backHref="/command-center" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 overflow-auto">
        {/* Top bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              Project Workflows
            </h2>
            <p className="text-muted-foreground text-sm">
              Track projects from lead intake to project management.
            </p>
          </div>
          <CreateWorkflowDialog profiles={profiles} />
        </div>

        {/* Stage summary */}
        <div className="flex flex-wrap gap-2">
          {WORKFLOW_STAGES.map((stage) => (
            <Badge
              key={stage.key}
              variant="secondary"
              className="text-xs"
            >
              <span
                className={`inline-block w-2 h-2 rounded-full mr-1.5 ${stage.color}`}
              />
              {stage.label}: {stageCounts[stage.key] || 0}
            </Badge>
          ))}
          <Badge variant="outline" className="text-xs">
            Active: {activeCount} · Completed: {completedCount}
          </Badge>
        </div>

        {/* Workflow grid */}
        {workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-muted-foreground mb-4">
              No workflows yet. Start one to automate your project pipeline.
            </p>
            <CreateWorkflowDialog profiles={profiles} />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workflows.map((workflow) => (
              <WorkflowCard key={workflow.id} workflow={workflow} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
