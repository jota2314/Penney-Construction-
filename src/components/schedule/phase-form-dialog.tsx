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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createSchedulePhase,
  updateSchedulePhase,
} from "@/lib/actions/schedule";
import {
  DEFAULT_PHASE_NAMES,
  ALL_PHASE_STATUSES,
  PHASE_STATUS_LABELS,
  PHASE_COLOR_PALETTE,
} from "@/lib/constants/schedule";
import type { SchedulePhase, Employee, Subcontractor } from "@/types/database";

interface PhaseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  phase?: SchedulePhase | null;
  employees: Employee[];
  subcontractors: Subcontractor[];
}

export function PhaseFormDialog({
  open,
  onOpenChange,
  projectId,
  phase,
  employees,
  subcontractors,
}: PhaseFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(phase?.status ?? "not_started");
  const [color, setColor] = useState(phase?.color ?? "#3b82f6");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>(
    phase?.assigned_employee_ids ?? []
  );
  const [selectedSubs, setSelectedSubs] = useState<string[]>(
    phase?.assigned_sub_ids ?? []
  );
  const isEditing = !!phase;

  function toggleEmployee(id: string) {
    setSelectedEmployees((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleSub(id: string) {
    setSelectedSubs((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const input = {
      project_id: projectId,
      name: form.get("name") as string,
      description: form.get("description") as string,
      start_date: form.get("start_date") as string,
      end_date: form.get("end_date") as string,
      status,
      color,
      assigned_employee_ids: selectedEmployees,
      assigned_sub_ids: selectedSubs,
      notes: form.get("notes") as string,
    };

    const result = isEditing
      ? await updateSchedulePhase(phase.id, input)
      : await createSchedulePhase(input);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      onOpenChange(false);
    }
  }

  const activeEmployees = employees.filter((e) => e.status === "active");
  const activeSubs = subcontractors.filter((s) => s.is_active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Phase" : "Add Phase"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Phase Name *</Label>
            <Input
              id="name"
              name="name"
              required
              list="phase-name-options"
              defaultValue={phase?.name ?? ""}
            />
            <datalist id="phase-name-options">
              {DEFAULT_PHASE_NAMES.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              name="description"
              defaultValue={phase?.description ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="start_date">Start Date *</Label>
              <Input
                id="start_date"
                name="start_date"
                type="date"
                required
                defaultValue={phase?.start_date ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="end_date">End Date *</Label>
              <Input
                id="end_date"
                name="end_date"
                type="date"
                required
                defaultValue={phase?.end_date ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_PHASE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PHASE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex items-center gap-2 flex-wrap">
                {PHASE_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      color === c
                        ? "border-foreground scale-110"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>

          {activeEmployees.length > 0 && (
            <div className="grid gap-2">
              <Label>Assign Employees</Label>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto rounded-md border p-3">
                {activeEmployees.map((emp) => (
                  <label
                    key={emp.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedEmployees.includes(emp.id)}
                      onCheckedChange={() => toggleEmployee(emp.id)}
                    />
                    {emp.first_name} {emp.last_name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {activeSubs.length > 0 && (
            <div className="grid gap-2">
              <Label>Assign Subcontractors</Label>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto rounded-md border p-3">
                {activeSubs.map((sub) => (
                  <label
                    key={sub.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedSubs.includes(sub.id)}
                      onCheckedChange={() => toggleSub(sub.id)}
                    />
                    {sub.company_name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={phase?.notes ?? ""}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
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
                  : "Add Phase"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
