"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Briefcase,
  CheckCircle2,
  Clock3,
  Plus,
  Search,
  User,
  X,
} from "lucide-react";
import {
  assignProjectToCrew,
  unassignProjectFromCrew,
} from "@/lib/actions/crew-admin";
import { RateChip } from "./rate-editor";
import { useRouter } from "next/navigation";

interface EmployeeRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  profile_id: string | null;
  hourly_rate?: number | string | null;
  rate_hidden?: boolean;
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
  canEditRates?: boolean;
}

function initials(first: string, last: string): string {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "?";
}

export function CrewRosterView({
  employees,
  assignments,
  allowedEmails,
  activeProjects,
  canEditRates = false,
}: CrewRosterViewProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const fieldEmails = useMemo(
    () => new Set(allowedEmails.map((e) => e.email.toLowerCase())),
    [allowedEmails],
  );

  // Field crew (invited to the crew app) first, then everyone else on the
  // active roster. The old view showed field crew ONLY, which made the payroll
  // "set a rate on the Crew Roster" hint a dead end for office/unlinked staff.
  const { fieldEmployees, otherEmployees } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (e: EmployeeRow) =>
      !q ||
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
      (e.title ?? "").toLowerCase().includes(q) ||
      (e.email ?? "").toLowerCase().includes(q);

    const field: EmployeeRow[] = [];
    const other: EmployeeRow[] = [];
    for (const e of employees) {
      if (!matches(e)) continue;
      if (e.email && fieldEmails.has(e.email.toLowerCase())) field.push(e);
      else other.push(e);
    }
    return { fieldEmployees: field, otherEmployees: other };
  }, [employees, fieldEmails, query]);

  const employeeAssignments = useMemo(() => {
    const map = new Map<string, AssignmentRow[]>();
    for (const a of assignments) {
      const list = map.get(a.employee_id);
      if (list) list.push(a);
      else map.set(a.employee_id, [a]);
    }
    return map;
  }, [assignments]);

  async function handleAssign(employeeId: string, projectId: string) {
    await assignProjectToCrew(employeeId, projectId);
    router.refresh();
  }

  async function handleUnassign(employeeId: string, projectId: string) {
    await unassignProjectFromCrew(employeeId, projectId);
    router.refresh();
  }

  if (employees.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <User className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No active crew yet</p>
        <p className="text-xs mt-1">Use the Invite tab to add crew members</p>
      </Card>
    );
  }

  const renderCard = (emp: EmployeeRow) => (
    <CrewCard
      key={emp.id}
      employee={emp}
      assignments={employeeAssignments.get(emp.id) ?? []}
      activeProjects={activeProjects}
      canEditRates={canEditRates}
      onAssign={handleAssign}
      onUnassign={handleUnassign}
      onRateChanged={() => router.refresh()}
    />
  );

  return (
    <div className="space-y-4">
      {/* Search — the roster is long enough on a phone that scrolling to one
          person to fix their rate was the slow part. */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search crew…"
          className="pl-9"
        />
      </div>

      {fieldEmployees.length > 0 && (
        <section className="space-y-3">
          <SectionLabel
            text="Field crew"
            count={fieldEmployees.length}
            hint="Signed in to the crew app"
          />
          {fieldEmployees.map(renderCard)}
        </section>
      )}

      {otherEmployees.length > 0 && (
        <section className="space-y-3">
          <SectionLabel
            text="Other team members"
            count={otherEmployees.length}
            hint="Not invited to the crew app"
          />
          {otherEmployees.map(renderCard)}
        </section>
      )}

      {fieldEmployees.length === 0 && otherEmployees.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No one matches &ldquo;{query}&rdquo;</p>
        </Card>
      )}
    </div>
  );
}

function SectionLabel({
  text,
  count,
  hint,
}: {
  text: string;
  count: number;
  hint: string;
}) {
  return (
    <div className="flex items-baseline gap-2 px-0.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {text} ({count})
      </h3>
      <span className="text-[10px] text-muted-foreground/70 truncate">{hint}</span>
    </div>
  );
}

/* -------------------------------- crew card ------------------------------- */

function CrewCard({
  employee,
  assignments,
  activeProjects,
  canEditRates,
  onAssign,
  onUnassign,
  onRateChanged,
}: {
  employee: EmployeeRow;
  assignments: AssignmentRow[];
  activeProjects: { id: string; name: string; project_number: string }[];
  canEditRates: boolean;
  onAssign: (employeeId: string, projectId: string) => void;
  onUnassign: (employeeId: string, projectId: string) => void;
  onRateChanged: () => void;
}) {
  const empId = employee.id;
  const hasProfile = !!employee.profile_id;
  const rate =
    employee.hourly_rate == null ? null : Number(employee.hourly_rate);
  const name = `${employee.first_name} ${employee.last_name}`.trim();

  const assignedProjectIds = new Set(assignments.map((a) => a.project_id));
  const availableProjects = activeProjects.filter(
    (p) => !assignedProjectIds.has(p.id),
  );

  return (
    <Card className="p-3.5 sm:p-4">
      {/* min-w-0 all the way down so long names/emails truncate instead of
          pushing the status badge off the right edge on a phone. */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-600 dark:text-amber-400">
          {initials(employee.first_name, employee.last_name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium leading-tight truncate">{name}</p>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                hasProfile
                  ? "bg-green-500/15 text-green-500"
                  : "bg-yellow-500/15 text-yellow-600 dark:text-yellow-500"
              }`}
            >
              {hasProfile ? (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  Active
                </>
              ) : (
                <>
                  <Clock3 className="h-3 w-3" />
                  Pending
                </>
              )}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {employee.title && (
              <span className="text-xs text-muted-foreground truncate max-w-full">
                {employee.title}
              </span>
            )}
            <RateChip
              employeeId={empId}
              name={name}
              rate={rate}
              rateHidden={!!employee.rate_hidden}
              canEdit={canEditRates}
              onChanged={onRateChanged}
            />
          </div>

          {employee.email && (
            <p className="mt-1 text-[11px] text-muted-foreground truncate">
              {employee.email}
            </p>
          )}
        </div>
      </div>

      {/* Assigned projects */}
      <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Briefcase className="h-3 w-3" />
          Assigned projects ({assignments.length})
        </p>

        {assignments.length === 0 && (
          <p className="text-[11px] text-muted-foreground/70">None yet</p>
        )}

        {assignments.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5"
          >
            <span className="min-w-0 flex-1 truncate text-sm">
              {a.projects?.name || "Unknown"}
              {a.projects?.project_number && (
                <span className="ml-1 text-[11px] text-muted-foreground">
                  {a.projects.project_number}
                </span>
              )}
            </span>
            <button
              onClick={() => onUnassign(empId, a.project_id)}
              className="shrink-0 text-muted-foreground transition-colors hover:text-red-400"
              aria-label={`Unassign ${a.projects?.name ?? "project"}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}

        {availableProjects.length > 0 && (
          <AssignProjectSelect
            employeeId={empId}
            projects={availableProjects}
            onAssign={onAssign}
          />
        )}
      </div>
    </Card>
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
