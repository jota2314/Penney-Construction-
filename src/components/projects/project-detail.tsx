"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { ProjectStatusBadge } from "./project-status-badge";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { PROJECT_TYPE_LABELS } from "@/lib/constants/project";
import type { Project, Customer } from "@/types/database";

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

interface ProjectDetailProps {
  project: Project;
  customer: Customer | null;
  customers: Customer[];
  teamMembers: TeamMember[];
  pmName: string | null;
  estimatorName: string | null;
}

export function ProjectDetail({
  project,
  customer,
  customers,
  teamMembers,
  pmName,
  estimatorName,
}: ProjectDetailProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const formatCurrency = (val: number | null) =>
    val != null
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(val)
      : "—";

  const formatDate = (val: string | null) =>
    val ? new Date(val).toLocaleDateString() : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{project.name}</h2>
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="text-muted-foreground font-mono text-sm">
            {project.project_number}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project Info</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span>{PROJECT_TYPE_LABELS[project.project_type]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Customer</span>
              <span>
                {customer
                  ? `${customer.first_name} ${customer.last_name}`
                  : "—"}
              </span>
            </div>
            {project.description && (
              <div>
                <span className="text-muted-foreground">Description</span>
                <p className="mt-1">{project.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Location</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Address</span>
              <span>{project.address ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">City</span>
              <span>{project.city ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">State</span>
              <span>{project.state ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Zip</span>
              <span>{project.zip ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. Start</span>
              <span>{formatDate(project.estimated_start_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. End</span>
              <span>{formatDate(project.estimated_end_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Actual Start</span>
              <span>{formatDate(project.actual_start_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Actual End</span>
              <span>{formatDate(project.actual_end_date)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Financial</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimated Value</span>
              <span className="font-medium">
                {formatCurrency(project.estimated_value)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Contract Value</span>
              <span className="font-medium">
                {formatCurrency(project.contract_value)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Project Manager</span>
              <span>{pmName ?? "Unassigned"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimator</span>
              <span>{estimatorName ?? "Unassigned"}</span>
            </div>
          </CardContent>
        </Card>

        {project.notes && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{project.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={project}
        customers={customers}
        teamMembers={teamMembers}
      />

      <ProjectDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        project={project}
        redirectOnDelete
      />
    </div>
  );
}
