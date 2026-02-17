"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { ProjectStatusBadge } from "./project-status-badge";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import {
  ALL_STATUSES,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
} from "@/lib/constants/project";
import type { Project, Customer } from "@/types/database";

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

interface ProjectListProps {
  projects: (Project & { customer?: { first_name: string; last_name: string } | null })[];
  customers: Customer[];
  teamMembers: TeamMember[];
}

export function ProjectList({
  projects,
  customers,
  teamMembers,
}: ProjectListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";

  const [formOpen, setFormOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);

  function handleStatusFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    router.push(`/projects?${params.toString()}`);
  }

  const filtered =
    statusFilter === "all"
      ? projects
      : projects.filter((p) => p.status === statusFilter);

  const formatCurrency = (val: number | null) =>
    val != null
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(val)
      : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Select value={statusFilter} onValueChange={handleStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project #</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Est. Value</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  {projects.length === 0
                    ? "No projects yet. Create your first project to get started."
                    : "No projects match the selected filter."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="font-mono text-sm">
                    <Link
                      href={`/projects/${project.id}`}
                      className="hover:underline"
                    >
                      {project.project_number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${project.id}`}
                      className="hover:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {project.customer
                      ? `${project.customer.first_name} ${project.customer.last_name}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {PROJECT_TYPE_LABELS[project.project_type]}
                  </TableCell>
                  <TableCell>
                    <ProjectStatusBadge status={project.status} />
                  </TableCell>
                  <TableCell>
                    {formatCurrency(project.estimated_value)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditProject(project)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteProject(project)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        customers={customers}
        teamMembers={teamMembers}
      />

      {editProject && (
        <ProjectFormDialog
          open={!!editProject}
          onOpenChange={(open) => {
            if (!open) setEditProject(null);
          }}
          project={editProject}
          customers={customers}
          teamMembers={teamMembers}
        />
      )}

      {deleteProject && (
        <ProjectDeleteDialog
          open={!!deleteProject}
          onOpenChange={(open) => {
            if (!open) setDeleteProject(null);
          }}
          project={deleteProject}
        />
      )}
    </div>
  );
}
