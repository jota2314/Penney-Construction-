"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { ProjectStatusBadge } from "./project-status-badge";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { updateProjectField } from "@/lib/actions/projects";
import {
  CRM_STATUSES,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  ALL_PROJECT_TYPES,
} from "@/lib/constants/project";
import { formatCurrency } from "@/lib/utils";
import { AddressLink } from "@/components/ui/address-link";
import type { Project, Customer, ProjectStatus, ProjectType } from "@/types/database";

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

type ListMode = "crm" | "projects";

interface ProjectListProps {
  projects: (Project & {
    customer?: { first_name: string; last_name: string } | null;
  })[];
  customers: Customer[];
  teamMembers: TeamMember[];
  mode: ListMode;
}

const parseCurrency = (val: string): number | null => {
  const num = parseFloat(val.replace(/[^0-9.-]/g, ""));
  return isNaN(num) ? null : num;
};

// Statuses that trigger promotion from CRM → Projects
const PROMOTION_STATUSES: ProjectStatus[] = ["contracted", "in_progress", "audit", "completed"];

// Inline editable currency cell
function EditableValue({
  projectId,
  value,
  onSaved,
}: {
  projectId: string;
  value: number | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value?.toString() ?? "");
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, value]);

  const save = useCallback(async () => {
    const parsed = parseCurrency(draft);
    if (parsed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    await updateProjectField(projectId, "estimated_value", parsed);
    setSaving(false);
    setEditing(false);
    onSaved();
  }, [draft, value, projectId, onSaved]);

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground text-sm">$</span>
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={save}
          disabled={saving}
          className="h-7 w-24 text-sm px-1"
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-sm font-medium hover:bg-orange-50 hover:text-orange-700 px-2 py-1 -mx-2 rounded transition-colors cursor-pointer"
      title="Click to edit"
    >
      {formatCurrency(value)}
    </button>
  );
}

// Inline editable status cell
function EditableStatus({
  projectId,
  status,
  allowedStatuses,
  onStatusChange,
}: {
  projectId: string;
  status: ProjectStatus;
  allowedStatuses: ProjectStatus[];
  onStatusChange: (projectId: string, newStatus: ProjectStatus) => void;
}) {
  const [editing, setEditing] = useState(false);

  const handleChange = async (newStatus: string) => {
    if (newStatus === status) {
      setEditing(false);
      return;
    }
    await updateProjectField(projectId, "status", newStatus);
    setEditing(false);
    onStatusChange(projectId, newStatus as ProjectStatus);
  };

  if (editing) {
    return (
      <Select defaultValue={status} onValueChange={handleChange} open>
        <SelectTrigger className="h-7 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent onPointerDownOutside={() => setEditing(false)}>
          {allowedStatuses.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">
              {PROJECT_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <button onClick={() => setEditing(true)} className="cursor-pointer">
      <ProjectStatusBadge status={status} />
    </button>
  );
}

// Inline editable type cell
function EditableType({
  projectId,
  projectType,
  onSaved,
}: {
  projectId: string;
  projectType: ProjectType;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);

  const handleChange = async (newType: string) => {
    if (newType === projectType) {
      setEditing(false);
      return;
    }
    await updateProjectField(projectId, "project_type", newType);
    setEditing(false);
    onSaved();
  };

  if (editing) {
    return (
      <Select defaultValue={projectType} onValueChange={handleChange} open>
        <SelectTrigger className="h-7 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent onPointerDownOutside={() => setEditing(false)}>
          {ALL_PROJECT_TYPES.map((t) => (
            <SelectItem key={t} value={t} className="text-xs">
              {PROJECT_TYPE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-xs hover:bg-orange-50 hover:text-orange-700 px-2 py-0.5 -mx-2 rounded transition-colors cursor-pointer"
      title="Click to change"
    >
      {PROJECT_TYPE_LABELS[projectType]}
    </button>
  );
}

export function ProjectList({
  projects,
  customers,
  teamMembers,
  mode,
}: ProjectListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "all";
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);

  const isCrm = mode === "crm";
  const basePath = isCrm ? "/projects" : "/active-projects";
  const modeStatuses = isCrm ? CRM_STATUSES : PROJECT_STATUSES;
  // Status dropdown shows mode statuses + cancelled + the "other side" so users can promote/demote
  const allAvailableStatuses: ProjectStatus[] = isCrm
    ? [...CRM_STATUSES, ...PROMOTION_STATUSES, "cancelled"]
    : [...PROJECT_STATUSES, "cancelled"];

  function handleStatusFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    router.push(`${basePath}?${params.toString()}`);
  }

  // When status changes, check if it moved to the other side
  function handleStatusChange(projectId: string, newStatus: ProjectStatus) {
    if (isCrm && PROMOTION_STATUSES.includes(newStatus)) {
      // Promoted from CRM → Project! Redirect to the project detail
      router.push(`/projects/${projectId}`);
    } else {
      router.refresh();
    }
  }

  const filtered = projects
    .filter((p) => statusFilter === "all" || p.status === statusFilter)
    .filter((p) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const customerName = p.customer
        ? `${p.customer.first_name} ${p.customer.last_name}`.toLowerCase()
        : "";
      return (
        p.name.toLowerCase().includes(q) ||
        p.project_number.toLowerCase().includes(q) ||
        customerName.includes(q) ||
        (p.address ?? "").toLowerCase().includes(q) ||
        (p.city ?? "").toLowerCase().includes(q)
      );
    });

  const totalValue = filtered.reduce(
    (sum, p) => sum + (p.estimated_value ?? 0),
    0
  );

  const emptyLabel = isCrm
    ? "No leads yet. Create your first to get started."
    : "No active projects. Projects appear here once approved in the CRM.";

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={isCrm ? "Search CRM..." : "Search projects..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 w-full sm:w-[220px]"
            />
          </div>
          <Select value={statusFilter} onValueChange={handleStatusFilter}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {modeStatuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground hidden sm:block">
            <span className="font-semibold text-foreground">{filtered.length}</span>{" "}
            {isCrm ? "leads" : "projects"}
            {totalValue > 0 && (
              <>
                {" "}· <span className="font-semibold text-foreground">{formatCurrency(totalValue)}</span> total
              </>
            )}
          </div>
          {isCrm && (
            <Button onClick={() => setFormOpen(true)} className="h-9">
              <Plus className="mr-2 h-4 w-4" />
              New Lead
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="font-semibold">{isCrm ? "Lead" : "Project"}</TableHead>
              <TableHead className="hidden md:table-cell font-semibold">Client</TableHead>
              <TableHead className="hidden lg:table-cell font-semibold">Address</TableHead>
              <TableHead className="hidden md:table-cell font-semibold">Type</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              {isCrm && (
                <TableHead className="hidden md:table-cell font-semibold">Walkthrough</TableHead>
              )}
              <TableHead className="hidden md:table-cell font-semibold text-right">Est. Value</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isCrm ? 8 : 7}
                  className="text-center text-muted-foreground py-12"
                >
                  {projects.length === 0
                    ? emptyLabel
                    : "No results match your search."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((project) => {
                const address = [project.address, project.city, project.state]
                  .filter(Boolean)
                  .join(", ");
                const customerName = project.customer
                  ? `${project.customer.first_name} ${project.customer.last_name}`
                  : null;

                return (
                  <TableRow
                    key={project.id}
                    className="group hover:bg-muted/30 transition-colors"
                  >
                    <TableCell>
                      <Link
                        href={`/projects/${project.id}`}
                        className="hover:underline font-medium"
                      >
                        {project.name}
                      </Link>
                      <div className="text-xs text-muted-foreground font-mono">
                        {project.project_number}
                      </div>
                      <div className="md:hidden text-xs text-muted-foreground mt-1 space-y-0.5">
                        {customerName && <div>{customerName}</div>}
                        {project.estimated_value != null && (
                          <div className="font-medium text-foreground">
                            {formatCurrency(project.estimated_value)}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {customerName || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-[200px] truncate">
                      <AddressLink
                        address={project.address}
                        city={project.city}
                        state={project.state}
                        className="max-w-full truncate hover:text-amber-500"
                      />
                      {!address && "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <EditableType
                        projectId={project.id}
                        projectType={project.project_type}
                        onSaved={() => router.refresh()}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableStatus
                        projectId={project.id}
                        status={project.status}
                        allowedStatuses={allAvailableStatuses}
                        onStatusChange={handleStatusChange}
                      />
                    </TableCell>
                    {isCrm && (
                      <TableCell className="hidden md:table-cell text-sm">
                        {project.walkthrough_scheduled_at ? (
                          <div>
                            <div className="font-medium">
                              {new Date(project.walkthrough_scheduled_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                              {" "}
                              {new Date(project.walkthrough_scheduled_at).toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </div>
                            {(() => {
                              const assignee = (project as unknown as { walkthrough_assignee?: { full_name: string | null } | null }).walkthrough_assignee;
                              return assignee?.full_name ? (
                                <div className="text-xs text-muted-foreground">{assignee.full_name}</div>
                              ) : null;
                            })()}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="hidden md:table-cell text-right">
                      <EditableValue
                        projectId={project.id}
                        value={project.estimated_value}
                        onSaved={() => router.refresh()}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditProject(project)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteProject(project)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        customers={customers}
        teamMembers={teamMembers}
        mode={mode}
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
