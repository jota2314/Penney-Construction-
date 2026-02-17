"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProject, updateProject } from "@/lib/actions/projects";
import {
  ALL_STATUSES,
  ALL_PROJECT_TYPES,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
} from "@/lib/constants/project";
import type { Project, Customer, ProjectStatus, ProjectType } from "@/types/database";

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project | null;
  customers: Customer[];
  teamMembers: TeamMember[];
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  customers,
  teamMembers,
}: ProjectFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "lead");
  const [projectType, setProjectType] = useState<ProjectType>(project?.project_type ?? "remodel");
  const [customerId, setCustomerId] = useState(project?.customer_id ?? "");
  const [assignedPm, setAssignedPm] = useState(project?.assigned_pm ?? "");
  const [assignedEstimator, setAssignedEstimator] = useState(
    project?.assigned_estimator ?? ""
  );
  const isEditing = !!project;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const input = {
      name: form.get("name") as string,
      customer_id: customerId || undefined,
      status: status as Project["status"],
      project_type: projectType as Project["project_type"],
      description: form.get("description") as string,
      address: form.get("address") as string,
      city: form.get("city") as string,
      state: form.get("state") as string,
      zip: form.get("zip") as string,
      estimated_start_date: form.get("estimated_start_date") as string,
      estimated_end_date: form.get("estimated_end_date") as string,
      estimated_value: parseFloat(form.get("estimated_value") as string) || undefined,
      contract_value: parseFloat(form.get("contract_value") as string) || undefined,
      assigned_pm: assignedPm || undefined,
      assigned_estimator: assignedEstimator || undefined,
      notes: form.get("notes") as string,
    };

    const result = isEditing
      ? await updateProject(project.id, input)
      : await createProject(input);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Project" : "New Project"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Project Name *</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={project?.name ?? ""}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Status *</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PROJECT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Project Type *</Label>
              <Select value={projectType} onValueChange={(v) => setProjectType(v as ProjectType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_PROJECT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {PROJECT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No customer</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              defaultValue={project?.description ?? ""}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              name="address"
              defaultValue={project?.address ?? ""}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                name="city"
                defaultValue={project?.city ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                name="state"
                defaultValue={project?.state ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="zip">Zip</Label>
              <Input
                id="zip"
                name="zip"
                defaultValue={project?.zip ?? ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="estimated_start_date">Est. Start Date</Label>
              <Input
                id="estimated_start_date"
                name="estimated_start_date"
                type="date"
                defaultValue={project?.estimated_start_date ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="estimated_end_date">Est. End Date</Label>
              <Input
                id="estimated_end_date"
                name="estimated_end_date"
                type="date"
                defaultValue={project?.estimated_end_date ?? ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="estimated_value">Estimated Value ($)</Label>
              <Input
                id="estimated_value"
                name="estimated_value"
                type="number"
                step="0.01"
                defaultValue={project?.estimated_value ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contract_value">Contract Value ($)</Label>
              <Input
                id="contract_value"
                name="contract_value"
                type="number"
                step="0.01"
                defaultValue={project?.contract_value ?? ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Assigned PM</Label>
              <Select value={assignedPm} onValueChange={(v) => setAssignedPm(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select PM" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name ?? m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Assigned Estimator</Label>
              <Select
                value={assignedEstimator}
                onValueChange={(v) => setAssignedEstimator(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Estimator" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {teamMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name ?? m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={project?.notes ?? ""}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? "Saving..."
                : isEditing
                  ? "Save Changes"
                  : "Create Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
