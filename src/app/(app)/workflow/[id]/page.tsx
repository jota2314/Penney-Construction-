import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { requireAuth } from "@/lib/auth/require-auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkflowPipeline } from "@/components/workflow/workflow-pipeline";
import { WorkflowActionsPanel } from "@/components/workflow/workflow-actions-panel";
import { WorkflowActivityLog } from "@/components/workflow/workflow-activity-log";
import { getStageInfo } from "@/lib/constants/workflow";
import type { WorkflowInstance, WorkflowAction, Profile } from "@/types/database";
import { WorkflowDetailActions } from "@/components/workflow/workflow-detail-actions";
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  FolderOpen,
  Calendar,
  FileSpreadsheet,
  DollarSign,
  ExternalLink,
} from "lucide-react";

export const metadata: Metadata = { title: "Workflow Details | Penney Construction" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WorkflowDetailPage({ params }: Props) {
  const { id } = await params;
  await requireAuth();
  const supabase = await createClient();

  const [workflowRes, actionsRes, profilesRes] = await Promise.all([
    supabase
      .from("workflow_instances")
      .select("*")
      .eq("id", id)
      .single(),
    supabase
      .from("workflow_actions")
      .select("*")
      .eq("workflow_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("*"),
  ]);

  if (!workflowRes.data) notFound();

  const workflow = workflowRes.data as WorkflowInstance;
  const actions = (actionsRes.data || []) as WorkflowAction[];
  const profiles = (profilesRes.data || []) as Profile[];

  const stageInfo = getStageInfo(workflow.current_stage);

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    paused: "bg-yellow-100 text-yellow-800",
    completed: "bg-blue-100 text-blue-800",
    cancelled: "bg-red-100 text-red-800",
  };

  // Lookup assigned people
  const estimator = profiles.find((p) => p.id === workflow.assigned_estimator);
  const pm = profiles.find((p) => p.id === workflow.assigned_pm);

  return (
    <>
      <Header title={workflow.project_name} backHref="/workflow" backLabel="Workflow" />
      <div className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6">
        {/* Back button and header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/workflow">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">
                {workflow.project_name}
              </h2>
              <Badge variant="secondary" className={statusColors[workflow.status]}>
                {workflow.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {stageInfo?.label} — {stageInfo?.description}
            </p>
          </div>
          <WorkflowDetailActions
            workflowId={workflow.id}
            projectName={workflow.project_name}
            clientName={workflow.client_name}
          />
        </div>

        {/* Pipeline visualization */}
        <Card>
          <CardContent className="pt-6">
            <WorkflowPipeline currentStage={workflow.current_stage} />
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Left column: Details */}
          <div className="lg:col-span-2 space-y-4">
            {/* Client & Project Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Project Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Client:</span>
                    {workflow.client_name}
                  </div>
                  {workflow.client_email && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Email:</span>
                      <a
                        href={`mailto:${workflow.client_email}`}
                        className="text-primary hover:underline"
                      >
                        {workflow.client_email}
                      </a>
                    </div>
                  )}
                  {workflow.client_phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Phone:</span>
                      {workflow.client_phone}
                    </div>
                  )}
                  {workflow.project_address && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Address:</span>
                      {[
                        workflow.project_address,
                        workflow.project_city,
                        workflow.project_state,
                        workflow.project_zip,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {workflow.project_type && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">Type:</span>
                      <Badge variant="outline">
                        {workflow.project_type.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  )}
                  {workflow.walkthrough_date && (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Walkthrough:</span>
                      {new Date(workflow.walkthrough_date).toLocaleString()}
                    </div>
                  )}
                  {workflow.estimate_amount && (
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Estimate:</span>$
                      {Number(workflow.estimate_amount).toLocaleString()}
                    </div>
                  )}
                  {workflow.deposit_amount && (
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Deposit:</span>$
                      {Number(workflow.deposit_amount).toLocaleString()}
                    </div>
                  )}
                  {estimator && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">Estimator:</span>
                      {estimator.full_name || estimator.email}
                    </div>
                  )}
                  {pm && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">PM:</span>
                      {pm.full_name || pm.email}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Google integrations */}
            {(workflow.google_drive_folder_url || workflow.google_sheet_url) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Google Integrations
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                  {workflow.google_drive_folder_url && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={workflow.google_drive_folder_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        Google Drive Folder
                        <ExternalLink className="ml-2 h-3 w-3" />
                      </a>
                    </Button>
                  )}
                  {workflow.google_sheet_url && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={workflow.google_sheet_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Estimate Sheet
                        <ExternalLink className="ml-2 h-3 w-3" />
                      </a>
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Description */}
            {workflow.project_description && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Project Description
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">
                    {workflow.project_description}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Activity log */}
            <WorkflowActivityLog actions={actions} />
          </div>

          {/* Right column: Actions */}
          <div className="space-y-4">
            <WorkflowActionsPanel workflow={workflow} profiles={profiles} />

            {/* Stage timestamps */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {[
                    { label: "Lead Intake", date: workflow.lead_intake_at },
                    { label: "Schedule Confirmed", date: workflow.schedule_confirmed_at },
                    { label: "Walkthrough", date: workflow.walkthrough_completed_at },
                    { label: "Estimate Submitted", date: workflow.estimate_sent_at },
                    { label: "Owner Approved", date: workflow.owner_approved_at },
                    { label: "Client Approved", date: workflow.client_approved_at },
                    { label: "Deposit Received", date: workflow.deposit_received_confirmed_at },
                    { label: "Permit Pulled", date: workflow.permit_pulled_at },
                    { label: "Job Package", date: workflow.job_package_created_at },
                    { label: "PM Handoff", date: workflow.pm_handoff_at },
                    { label: "Construction Started", date: workflow.construction_started_at },
                    { label: "Rough Inspection", date: workflow.rough_inspection_at },
                    { label: "Final Inspection", date: workflow.final_inspection_at },
                    { label: "Audit Complete", date: workflow.audit_at },
                  ]
                    .filter((t) => t.date)
                    .map((t) => (
                      <div key={t.label} className="flex justify-between">
                        <span className="text-muted-foreground">{t.label}</span>
                        <span>{new Date(t.date!).toLocaleDateString()}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
