"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  GripVertical,
  Calendar,
  CheckCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface SchedulePhase {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  status: string;
  color: string;
  event_type: string | null;
  notes: string | null;
  sort_order: number;
}

interface ProjectScheduleTabProps {
  projectId: string;
  projectName: string;
  phases: SchedulePhase[];
  userId: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  not_started: { label: "Not Started", color: "bg-slate-500", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-blue-500", icon: Clock },
  completed: { label: "Done", color: "bg-emerald-500", icon: CheckCircle },
  on_hold: { label: "On Hold", color: "bg-amber-500", icon: AlertTriangle },
};

const PHASE_COLORS = [
  "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#6366f1", "#14b8a6", "#f97316",
];

export function ProjectScheduleTab({
  projectId,
  projectName,
  phases: initialPhases,
  userId,
}: ProjectScheduleTabProps) {
  const [phases, setPhases] = useState(initialPhases);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const router = useRouter();

  const today = new Date().toISOString().split("T")[0];
  const totalPhases = phases.length;
  const completedPhases = phases.filter((p) => p.status === "completed").length;
  const overduePhases = phases.filter(
    (p) => p.status !== "completed" && p.end_date < today
  ).length;
  const progress = totalPhases > 0 ? Math.round((completedPhases / totalPhases) * 100) : 0;

  async function handleAddPhase(formData: FormData) {
    setSaving(true);
    const supabase = createClient();

    const name = formData.get("name") as string;
    const startDate = formData.get("start_date") as string;
    const endDate = formData.get("end_date") as string || startDate;
    const color = PHASE_COLORS[phases.length % PHASE_COLORS.length];

    const { data, error } = await supabase
      .from("schedule_phases")
      .insert({
        project_id: projectId,
        name,
        start_date: startDate,
        end_date: endDate,
        planned_start_date: startDate,
        planned_end_date: endDate,
        status: "not_started",
        event_type: (formData.get("event_type") as string) || "phase",
        notes: (formData.get("notes") as string) || null,
        sort_order: phases.length,
        color,
        created_by: userId,
      })
      .select("*")
      .single();

    if (!error && data) {
      setPhases((prev) => [...prev, data]);
      setShowAdd(false);
    }
    setSaving(false);
  }

  async function handleUpdateStatus(phaseId: string, newStatus: string) {
    const supabase = createClient();
    await supabase
      .from("schedule_phases")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", phaseId);
    setPhases((prev) =>
      prev.map((p) => (p.id === phaseId ? { ...p, status: newStatus } : p))
    );
  }

  async function handleUpdateDates(phaseId: string, startDate: string, endDate: string) {
    const supabase = createClient();
    await supabase
      .from("schedule_phases")
      .update({
        start_date: startDate,
        end_date: endDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", phaseId);
    setPhases((prev) =>
      prev.map((p) =>
        p.id === phaseId ? { ...p, start_date: startDate, end_date: endDate } : p
      )
    );
    setEditingId(null);
  }

  async function handleDelete(phaseId: string) {
    const supabase = createClient();
    await supabase.from("schedule_phases").delete().eq("id", phaseId);
    setPhases((prev) => prev.filter((p) => p.id !== phaseId));
  }

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-amber-500" />
          <div>
            <h3 className="text-sm font-semibold">Project Schedule</h3>
            <p className="text-xs text-muted-foreground">
              {totalPhases} phases · {completedPhases} done · {progress}% complete
              {overduePhases > 0 && (
                <span className="text-red-400 ml-1">· {overduePhases} overdue</span>
              )}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setShowAdd(!showAdd)}
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Phase
        </Button>
      </div>

      {/* Progress bar */}
      {totalPhases > 0 && (
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Add phase form */}
      {showAdd && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAddPhase(new FormData(e.currentTarget));
          }}
          className="p-4 rounded-lg border bg-card space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Phase Name *</label>
              <input
                name="name"
                required
                placeholder="e.g. Demolition, Framing, Electrical rough-in..."
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Start Date *</label>
              <input
                name="start_date"
                type="date"
                required
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">End Date</label>
              <input
                name="end_date"
                type="date"
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Type</label>
              <select
                name="event_type"
                defaultValue="phase"
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="phase">Construction Phase</option>
                <option value="inspection">Inspection</option>
                <option value="walkthrough">Walkthrough</option>
                <option value="meeting">Meeting</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <input
                name="notes"
                placeholder="Optional details..."
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
              {saving ? "Adding..." : "Add Phase"}
            </Button>
          </div>
        </form>
      )}

      {/* Phase list */}
      {phases.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No schedule phases yet</p>
          <p className="text-xs mt-1">Click &quot;Add Phase&quot; to start planning</p>
        </div>
      ) : (
        <div className="space-y-2">
          {phases
            .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.sort_order - b.sort_order)
            .map((phase) => {
              const status = STATUS_CONFIG[phase.status] || STATUS_CONFIG.not_started;
              const isOverdue = phase.status !== "completed" && phase.end_date < today;
              const isEditing = editingId === phase.id;
              const variance = phase.planned_end_date
                ? Math.round(
                    (new Date(phase.end_date).getTime() - new Date(phase.planned_end_date).getTime()) /
                      (1000 * 60 * 60 * 24)
                  )
                : 0;

              return (
                <div
                  key={phase.id}
                  className={`rounded-lg border p-3 flex items-start gap-3 ${
                    isOverdue ? "border-red-500/50" : ""
                  }`}
                >
                  {/* Color indicator */}
                  <div
                    className="w-1.5 h-full min-h-[40px] rounded-full shrink-0"
                    style={{ backgroundColor: phase.color }}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{phase.name}</span>
                      <Badge className={`${status.color} text-white text-[10px]`}>
                        {status.label}
                      </Badge>
                      {isOverdue && (
                        <Badge className="bg-red-500 text-white text-[10px] animate-pulse">
                          Overdue
                        </Badge>
                      )}
                      {variance !== 0 && (
                        <span className={`text-[10px] font-medium ${variance > 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {variance > 0 ? `+${variance}d behind` : `${Math.abs(variance)}d ahead`}
                        </span>
                      )}
                    </div>

                    {/* Dates */}
                    {isEditing ? (
                      <form
                        className="flex items-center gap-2 mt-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          handleUpdateDates(
                            phase.id,
                            fd.get("start") as string,
                            fd.get("end") as string
                          );
                        }}
                      >
                        <input
                          name="start"
                          type="date"
                          defaultValue={phase.start_date}
                          className="rounded border bg-background px-2 py-1 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <input
                          name="end"
                          type="date"
                          defaultValue={phase.end_date}
                          className="rounded border bg-background px-2 py-1 text-xs"
                        />
                        <Button type="submit" size="sm" variant="outline" className="text-xs h-7">
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="text-xs h-7" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <button
                        onClick={() => setEditingId(phase.id)}
                        className="text-xs text-muted-foreground mt-1 hover:text-foreground"
                      >
                        {new Date(phase.start_date).toLocaleDateString()} — {new Date(phase.end_date).toLocaleDateString()}
                        {phase.planned_start_date && phase.planned_start_date !== phase.start_date && (
                          <span className="ml-2 opacity-50">
                            (planned: {new Date(phase.planned_start_date).toLocaleDateString()} — {new Date(phase.planned_end_date!).toLocaleDateString()})
                          </span>
                        )}
                      </button>
                    )}

                    {phase.notes && (
                      <p className="text-xs text-muted-foreground mt-1">{phase.notes}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Status selector */}
                    <select
                      value={phase.status}
                      onChange={(e) => handleUpdateStatus(phase.id, e.target.value)}
                      className="text-xs bg-background border rounded px-1.5 py-1"
                    >
                      <option value="not_started">Not Started</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Done</option>
                      <option value="on_hold">On Hold</option>
                    </select>
                    <button
                      onClick={() => handleDelete(phase.id)}
                      className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
