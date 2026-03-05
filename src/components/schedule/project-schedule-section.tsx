"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, CalendarDays } from "lucide-react";
import { PhaseStatusBadge } from "./phase-status-badge";
import { PhaseFormDialog } from "./phase-form-dialog";
import { PhaseDeleteDialog } from "./phase-delete-dialog";
import type { SchedulePhase, Employee, Subcontractor } from "@/types/database";

interface ProjectScheduleSectionProps {
  projectId: string;
  phases: SchedulePhase[];
  employees: Employee[];
  subcontractors: Subcontractor[];
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ProjectScheduleSection({
  projectId,
  phases,
  employees,
  subcontractors,
}: ProjectScheduleSectionProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editPhase, setEditPhase] = useState<SchedulePhase | null>(null);
  const [deletePhase, setDeletePhase] = useState<SchedulePhase | null>(null);

  const sorted = [...phases].sort((a, b) => a.sort_order - b.sort_order || a.start_date.localeCompare(b.start_date));

  function getAssignedNames(phase: SchedulePhase) {
    const names: string[] = [];
    for (const eid of phase.assigned_employee_ids) {
      const emp = employees.find((e) => e.id === eid);
      if (emp) names.push(`${emp.first_name} ${emp.last_name[0]}.`);
    }
    for (const sid of phase.assigned_sub_ids) {
      const sub = subcontractors.find((s) => s.id === sid);
      if (sub) names.push(sub.company_name);
    }
    return names;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            <CardTitle className="text-base">Schedule</CardTitle>
          </div>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Phase
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No schedule phases yet. Add phases to plan your project timeline.
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phase</TableHead>
                  <TableHead className="hidden md:table-cell">Dates</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Assigned</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((phase) => {
                  const assigned = getAssignedNames(phase);
                  return (
                    <TableRow key={phase.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: phase.color }}
                          />
                          <span className="font-medium">{phase.name}</span>
                        </div>
                        <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                          {formatDate(phase.start_date)} – {formatDate(phase.end_date)}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">
                        {formatDate(phase.start_date)} – {formatDate(phase.end_date)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <PhaseStatusBadge status={phase.status} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {assigned.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {assigned.map((name) => (
                              <Badge key={name} variant="outline" className="text-xs">
                                {name}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditPhase(phase)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletePhase(phase)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <PhaseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={projectId}
        employees={employees}
        subcontractors={subcontractors}
      />

      {editPhase && (
        <PhaseFormDialog
          open={!!editPhase}
          onOpenChange={(open) => {
            if (!open) setEditPhase(null);
          }}
          projectId={projectId}
          phase={editPhase}
          employees={employees}
          subcontractors={subcontractors}
        />
      )}

      {deletePhase && (
        <PhaseDeleteDialog
          open={!!deletePhase}
          onOpenChange={(open) => {
            if (!open) setDeletePhase(null);
          }}
          phase={deletePhase}
        />
      )}
    </Card>
  );
}
