"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { WorkflowAction } from "@/types/database";
import {
  ArrowRight,
  Mail,
  FolderPlus,
  Calendar,
  FileText,
  CheckCircle2,
  XCircle,
  DollarSign,
  Package,
  UserCheck,
  MessageSquare,
} from "lucide-react";

const ACTION_ICONS: Record<string, typeof ArrowRight> = {
  stage_advanced: ArrowRight,
  email_sent: Mail,
  folder_created: FolderPlus,
  meeting_created: Calendar,
  estimate_sent: FileText,
  client_approved: CheckCircle2,
  client_rejected: XCircle,
  deposit_received: DollarSign,
  contract_sent: FileText,
  job_package_created: Package,
  assigned_to_pm: UserCheck,
  note_added: MessageSquare,
};

interface WorkflowActivityLogProps {
  actions: WorkflowAction[];
}

export function WorkflowActivityLog({ actions }: WorkflowActivityLogProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity Log</CardTitle>
      </CardHeader>
      <CardContent>
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="space-y-4">
            {actions.map((action) => {
              const Icon = ACTION_ICONS[action.action_type] || MessageSquare;
              return (
                <div key={action.id} className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{action.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(action.created_at).toLocaleString()}
                      {" · "}
                      {action.stage.replace(/_/g, " ")}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
