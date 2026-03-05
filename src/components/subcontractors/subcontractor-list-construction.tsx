"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Star,
  DollarSign,
  Phone,
  Mail,
  CalendarDays,
  Pencil,
} from "lucide-react";
import { upsertContractAmount } from "@/lib/actions/subcontractors";
import type {
  Subcontractor,
  SchedulePhase,
  Project,
  ProjectSubcontractor,
} from "@/types/database";

interface SubcontractorListConstructionProps {
  subcontractors: Subcontractor[];
  schedulePhases: SchedulePhase[];
  projects: Pick<Project, "id" | "name" | "project_number">[];
  projectSubcontracts: ProjectSubcontractor[];
}

function RatingStars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-muted-foreground text-sm">No rating</span>;
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${
            i < rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const PHASE_STATUS_COLORS: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  on_hold: "bg-amber-100 text-amber-700",
};

const PHASE_STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Done",
  on_hold: "On Hold",
};

// ── Contract Amount Dialog ────────────────────────
interface ContractEditState {
  subId: string;
  subName: string;
  projects: {
    id: string;
    project_number: string;
    name: string;
    amount: number;
  }[];
}

function ContractAmountDialog({
  state,
  onClose,
}: {
  state: ContractEditState | null;
  onClose: () => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Initialize amounts when dialog opens with new sub
  const key = state?.subId ?? "";
  useMemo(() => {
    if (state) {
      const initial: Record<string, string> = {};
      for (const p of state.projects) {
        initial[p.id] = p.amount > 0 ? String(p.amount) : "";
      }
      setAmounts(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!state) return null;

  async function handleSave() {
    if (!state) return;
    setSaving(true);
    for (const p of state.projects) {
      const val = parseFloat(amounts[p.id] || "0");
      await upsertContractAmount(p.id, state.subId, val);
    }
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Contract Amounts — {state.subName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {state.projects.map((p) => (
            <div key={p.id} className="grid gap-1.5">
              <Label className="text-sm">
                {p.project_number} — {p.name}
              </Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  min={0}
                  step={100}
                  className="pl-9"
                  placeholder="0"
                  value={amounts[p.id] ?? ""}
                  onChange={(e) =>
                    setAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))
                  }
                />
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────
export function SubcontractorListConstruction({
  subcontractors,
  schedulePhases,
  projects,
  projectSubcontracts,
}: SubcontractorListConstructionProps) {
  const [search, setSearch] = useState("");
  const [contractEdit, setContractEdit] = useState<ContractEditState | null>(
    null
  );

  // Build lookups
  const contractMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const ps of projectSubcontracts) {
      map.set(`${ps.project_id}-${ps.subcontractor_id}`, ps.contract_amount);
    }
    return map;
  }, [projectSubcontracts]);

  const projectMap = useMemo(() => {
    const map = new Map<string, (typeof projects)[0]>();
    for (const p of projects) {
      map.set(p.id, p);
    }
    return map;
  }, [projects]);

  // For each sub, compute their project+phase assignments
  type SubAssignment = {
    project: (typeof projects)[0];
    phases: SchedulePhase[];
    contractAmount: number;
  };

  const subAssignments = useMemo(() => {
    const map = new Map<string, SubAssignment[]>();
    for (const sub of subcontractors) {
      const projectPhases = new Map<string, SchedulePhase[]>();
      for (const phase of schedulePhases) {
        if (phase.assigned_sub_ids?.includes(sub.id)) {
          const existing = projectPhases.get(phase.project_id) ?? [];
          existing.push(phase);
          projectPhases.set(phase.project_id, existing);
        }
      }
      const assignments: SubAssignment[] = [];
      for (const [projectId, phases] of projectPhases) {
        const project = projectMap.get(projectId);
        if (project) {
          assignments.push({
            project,
            phases: phases.sort((a, b) => a.sort_order - b.sort_order),
            contractAmount:
              contractMap.get(`${projectId}-${sub.id}`) ?? 0,
          });
        }
      }
      map.set(sub.id, assignments);
    }
    return map;
  }, [subcontractors, schedulePhases, projectMap, contractMap]);

  const filtered = useMemo(() => {
    if (!search.trim()) return subcontractors;
    const q = search.toLowerCase();
    return subcontractors.filter(
      (s) =>
        s.company_name.toLowerCase().includes(q) ||
        s.contact_name?.toLowerCase().includes(q) ||
        s.trades.some((t) => t.toLowerCase().includes(q))
    );
  }, [subcontractors, search]);

  function openContractDialog(sub: Subcontractor) {
    const assignments = subAssignments.get(sub.id) ?? [];
    setContractEdit({
      subId: sub.id,
      subName: sub.company_name,
      projects: assignments.map((a) => ({
        ...a.project,
        amount: a.contractAmount,
      })),
    });
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search subs by name or trade..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {subcontractors.length === 0
            ? "No subcontractors assigned to active projects yet."
            : "No subcontractors match your search."}
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((sub) => {
            const assignments = subAssignments.get(sub.id) ?? [];
            const totalContract = assignments.reduce(
              (sum, a) => sum + a.contractAmount,
              0
            );

            return (
              <Card key={sub.id}>
                <CardContent className="p-4 sm:p-5">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <h3 className="font-semibold text-base">
                        {sub.company_name}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                        {sub.contact_name && <span>{sub.contact_name}</span>}
                        {sub.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {sub.phone}
                          </span>
                        )}
                        {sub.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3.5 w-3.5" />
                            {sub.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <RatingStars rating={sub.rating} />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openContractDialog(sub)}
                      >
                        <DollarSign className="mr-1 h-3.5 w-3.5" />
                        {totalContract > 0
                          ? formatCurrency(totalContract)
                          : "Set Amount"}
                      </Button>
                    </div>
                  </div>

                  {/* Trades */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {sub.trades.map((trade) => (
                      <Badge key={trade} variant="secondary" className="text-xs">
                        {trade}
                      </Badge>
                    ))}
                  </div>

                  {/* Project & Phase assignments */}
                  {assignments.length > 0 && (
                    <div className="space-y-2 border-t pt-3">
                      {assignments.map((a) => (
                        <div key={a.project.id}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium">
                              {a.project.project_number} — {a.project.name}
                            </span>
                            {a.contractAmount > 0 && (
                              <span className="text-sm text-muted-foreground">
                                {formatCurrency(a.contractAmount)}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {a.phases.map((phase) => (
                              <div
                                key={phase.id}
                                className="flex items-center gap-1.5 text-xs rounded-md border px-2 py-1"
                              >
                                <CalendarDays className="h-3 w-3 text-muted-foreground" />
                                <span className="font-medium">
                                  {phase.name}
                                </span>
                                <span className="text-muted-foreground">
                                  {formatDate(phase.start_date)} –{" "}
                                  {formatDate(phase.end_date)}
                                </span>
                                <Badge
                                  variant="secondary"
                                  className={`text-[10px] px-1.5 py-0 ${
                                    PHASE_STATUS_COLORS[phase.status] ?? ""
                                  }`}
                                >
                                  {PHASE_STATUS_LABELS[phase.status] ??
                                    phase.status}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ContractAmountDialog
        state={contractEdit}
        onClose={() => setContractEdit(null)}
      />
    </div>
  );
}
