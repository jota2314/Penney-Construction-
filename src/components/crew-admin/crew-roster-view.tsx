"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Plus, X, Mail, CheckCircle } from "lucide-react";
import {
  assignProjectToCrew,
  unassignProjectFromCrew,
} from "@/lib/actions/crew-admin";
import { useRouter } from "next/navigation";

interface EmployeeRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  profile_id: string | null;
  [key: string]: unknown;
}

interface AssignmentRow {
  id: string;
  employee_id: string;
  project_id: string;
  projects: { name: string; project_number: string } | null;
  [key: string]: unknown;
}

interface CrewRosterViewProps {
  employees: EmployeeRow[];
  assignments: AssignmentRow[];
  allowedEmails: { email: string; [key: string]: unknown }[];
  activeProjects: { id: string; name: string; project_number: string }[];
}

export function CrewRosterView({
  employees,
  assignments,
  allowedEmails,
  activeProjects,
}: CrewRosterViewProps) {
  const router = useRouter();

  // Filter to field workers (those with email in allowed_emails with role field)
  const fieldEmails = new Set(
    allowedEmails.map((e) => e.email.toLowerCase())
  );

  const fieldEmployees = employees.filter(
    (e) =>
      e.email && fieldEmails.has(e.email.toLowerCase())
  );

  // Group assignments by employee
  const employeeAssignments = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    const empId = a.employee_id;
    if (!employeeAssignments.has(empId)) employeeAssignments.set(empId, []);
    employeeAssignments.get(empId)!.push(a);
  }

  async function handleAssign(employeeId: string, projectId: string) {
    await assignProjectToCrew(employeeId, projectId);
    router.refresh();
  }

  async function handleUnassign(employeeId: string, projectId: string) {
    await unassignProjectFromCrew(employeeId, projectId);
    router.refresh();
  }

  if (fieldEmployees.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <User className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No field workers invited yet</p>
        <p className="text-xs mt-1">Use the Invite tab to add crew members</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {fieldEmployees.map((emp) => {
        const empId = emp.id;
        const empAssignments = employeeAssignments.get(empId) || [];
        const assignedProjectIds = new Set(
          empAssignments.map((a) => a.project_id)
        );
        const availableProjects = activeProjects.filter(
          (p) => !assignedProjectIds.has(p.id)
        );
        const hasProfile = !!emp.profile_id;

        return (
          <Card key={empId} className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <User className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">
                    {emp.first_name} {emp.last_name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {emp.title && (
                      <span className="text-xs text-muted-foreground">
                        {emp.title}
                      </span>
                    )}
                    {emp.email && (
                      <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                        <Mail className="h-3 w-3" />
                        {emp.email}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Badge
                className={
                  hasProfile
                    ? "bg-green-500/15 text-green-500"
                    : "bg-yellow-500/15 text-yellow-500"
                }
              >
                {hasProfile ? (
                  <>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Active
                  </>
                ) : (
                  "Pending Login"
                )}
              </Badge>
            </div>

            {/* Assigned projects */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Assigned Projects ({empAssignments.length})
              </p>
              {empAssignments.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between bg-muted/30 rounded-md px-3 py-1.5"
                  >
                    <span className="text-sm">
                      {a.projects?.name || "Unknown"}{" "}
                      <span className="text-xs text-muted-foreground">
                        {a.projects?.project_number}
                      </span>
                    </span>
                    <button
                      onClick={() =>
                        handleUnassign(empId, a.project_id)
                      }
                      className="text-muted-foreground hover:text-red-400 transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
              ))}

              {/* Add project */}
              {availableProjects.length > 0 && (
                <AssignProjectSelect
                  employeeId={empId}
                  projects={availableProjects}
                  onAssign={handleAssign}
                />
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function AssignProjectSelect({
  employeeId,
  projects,
  onAssign,
}: {
  employeeId: string;
  projects: { id: string; name: string; project_number: string }[];
  onAssign: (employeeId: string, projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3 w-3 mr-1" />
        Assign Project
      </Button>
    );
  }

  return (
    <Select
      onValueChange={(projectId) => {
        onAssign(employeeId, projectId);
        setOpen(false);
      }}
    >
      <SelectTrigger className="text-xs">
        <SelectValue placeholder="Select a project..." />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name} ({p.project_number})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
