"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import {
  Plus,
  Trash2,
  Pencil,
  Calendar,
  CheckCircle,
  Clock,
  AlertTriangle,
  Bot,
  Send,
  Mic,
  MicOff,
  Loader2,
  ChevronDown,
  Users,
  ListChecks,
  GanttChartSquare,
  List,
  ShieldAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useRouter } from "next/navigation";
import { renderInlineMarkdown } from "@/lib/chat-markdown";
import { cascadeSchedule, type CascadeInput } from "@/lib/schedule/cascade";
import { Lock } from "lucide-react";
import { buildPlanFromEstimate, setPhaseConfirmation, updateSchedulePhase } from "@/lib/actions/schedule";
import type { ScheduleNotifyResult } from "@/lib/notifications/schedule-notify";
import { ScheduleGantt } from "@/components/schedule/schedule-gantt";
import {
  checkSequence,
  issuesByPhase,
  type SequenceIssue,
  type SequencePhase,
} from "@/lib/schedule/sequence-check";

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
  phase_scope?: string | null;
  estimate_line_item_id?: string | null;
  assigned_employee_ids?: string[];
  assigned_sub_ids?: string[];
  is_confirmed?: boolean;
  confirmed_with?: string | null;
}

interface LineItemOption {
  id: string;
  description: string;
  trade: string | null;
}

interface EmployeeOption {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
}

interface ProjectScheduleTabProps {
  projectId: string;
  projectName: string;
  projectDescription?: string | null;
  projectType?: string | null;
  projectAddress?: string | null;
  phases: SchedulePhase[];
  lineItems: LineItemOption[];
  employees: EmployeeOption[];
  userId: string;
}

interface AiChatMsg {
  role: "user" | "assistant";
  content: string;
  proposedPhases?: {
    name: string;
    start_date: string;
    end_date: string;
    event_type: string;
    notes?: string;
  }[];
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

function employeeInitials(e: { first_name: string; last_name: string }): string {
  const a = (e.first_name || "?").trim()[0] || "?";
  const b = (e.last_name || "").trim()[0] || "";
  return (a + b).toUpperCase();
}

function colorFromId(id: string): string {
  const palette = ["#D97706", "#0E7490", "#7C3AED", "#DC2626", "#059669", "#0891B2", "#B45309", "#0F766E"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function AssigneePicker({
  employees,
  selected,
  onToggle,
}: {
  employees: { id: string; first_name: string; last_name: string; title: string | null }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (employees.length === 0) {
    return (
      <p className="text-[11px] text-amber-500">
        No active employees. Add one in <span className="underline">/employees</span> first.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {employees.map((e) => {
        const isSel = selected.has(e.id);
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onToggle(e.id)}
            title={`${e.first_name} ${e.last_name}${e.title ? ` · ${e.title}` : ""}`}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition active:scale-95 inline-flex items-center gap-1.5 ${
              isSel
                ? "bg-amber-600/20 text-amber-300 border border-amber-500/50"
                : "bg-background text-muted-foreground border border-border hover:text-foreground"
            }`}
          >
            <span
              className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
              style={{ background: colorFromId(e.id) }}
            >
              {employeeInitials(e)}
            </span>
            {e.first_name}
          </button>
        );
      })}
    </div>
  );
}

export function ProjectScheduleTab({
  projectId,
  projectName,
  projectDescription,
  projectType,
  projectAddress,
  phases: initialPhases,
  lineItems,
  employees,
  userId,
}: ProjectScheduleTabProps) {
  const [phases, setPhases] = useState(initialPhases);
  const [showAdd, setShowAdd] = useState(false);
  const [buildingPlan, setBuildingPlan] = useState(false);
  const [buildResult, setBuildResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "gantt">("list");
  const [showIssues, setShowIssues] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notifyResult, setNotifyResult] = useState<ScheduleNotifyResult | null>(null);
  const [confirmPhaseId, setConfirmPhaseId] = useState<string | null>(null);
  const [confirmedWith, setConfirmedWith] = useState("");
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [addAssignees, setAddAssignees] = useState<Set<string>>(new Set());
  const [editAssignees, setEditAssignees] = useState<Set<string>>(new Set());

  const employeesById = useMemo(() => {
    const m = new Map<string, EmployeeOption>();
    employees.forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  function toggleSet(setState: (updater: (prev: Set<string>) => Set<string>) => void, id: string) {
    setState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startEditing(phase: SchedulePhase) {
    setEditingId(phase.id);
    setEditAssignees(new Set(phase.assigned_employee_ids ?? []));
  }
  const [showAi, setShowAi] = useState(false);
  const [aiMessages, setAiMessages] = useState<AiChatMsg[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [addingPhases, setAddingPhases] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { isListening, transcript, startListening, stopListening, isSupported } = useSpeechRecognition();

  useEffect(() => {
    if (transcript) setAiInput(transcript);
  }, [transcript]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages.length]);

  async function handleAiSend() {
    const text = aiInput.trim();
    if (!text || aiLoading) return;
    setAiInput("");
    stopListening();

    const userMsg: AiChatMsg = { role: "user", content: text };
    const history = [...aiMessages, userMsg];
    setAiMessages(history);
    setAiLoading(true);

    try {
      const res = await fetch("/api/schedule-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          userMessage: text,
          projectContext: {
            id: projectId,
            name: projectName,
            type: projectType,
            description: projectDescription,
            address: projectAddress,
            existingPhases: phases
              .filter((p) => p.phase_scope !== "daily")
              .map((p) => `${p.name} (${p.start_date} to ${p.end_date}) [${p.status}]`),
          },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const assistantMsg: AiChatMsg = {
        role: "assistant",
        content: data.message || "Here's what I suggest:",
        proposedPhases: data.schedule_actions?.filter(
          (a: Record<string, unknown>) => a.action === "create"
        ),
      };
      setAiMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setAiMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Failed"}` },
      ]);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAddAiPhases(proposedPhases: AiChatMsg["proposedPhases"]) {
    if (!proposedPhases || proposedPhases.length === 0) return;
    setAddingPhases(true);

    const supabase = createClient();
    const newPhases: SchedulePhase[] = [];

    for (let i = 0; i < proposedPhases.length; i++) {
      const p = proposedPhases[i];
      const color = PHASE_COLORS[(phases.length + i) % PHASE_COLORS.length];

      const { data, error } = await supabase
        .from("schedule_phases")
        .insert({
          project_id: projectId,
          name: p.name,
          start_date: p.start_date,
          end_date: p.end_date || p.start_date,
          planned_start_date: p.start_date,
          planned_end_date: p.end_date || p.start_date,
          status: "not_started",
          event_type: p.event_type || "phase",
          notes: p.notes || null,
          sort_order: phases.length + i,
          color,
          created_by: userId,
        })
        .select("*")
        .single();

      if (!error && data) newPhases.push(data);
    }

    setPhases((prev) => [...prev, ...newPhases]);
    setAddingPhases(false);
    router.refresh();
  }

  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const weekOut = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
  // Two schedules, one table: the PLAN is the master phases; day-to-day crew
  // rows (phase_scope 'daily') render in the short-term strip up top instead.
  const masterPhases = phases.filter((p) => p.phase_scope !== "daily");
  const shortTerm = phases
    .filter((p) => p.phase_scope === "daily" && p.end_date >= today && p.start_date <= weekOut)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const totalPhases = masterPhases.length;
  const completedPhases = masterPhases.filter((p) => p.status === "completed").length;
  const overduePhases = masterPhases.filter(
    (p) => p.status !== "completed" && p.end_date < today
  ).length;
  const progress = totalPhases > 0 ? Math.round((completedPhases / totalPhases) * 100) : 0;

  async function handleBuildFromEstimate() {
    setBuildingPlan(true);
    setMutationError(null);
    setBuildResult(null);
    const res = await buildPlanFromEstimate(projectId);
    setBuildingPlan(false);
    if (res.error) {
      setMutationError(res.error);
      return;
    }
    setBuildResult(
      res.created === 0
        ? "Every estimate line is already on the plan."
        : `Added ${res.created} steps from the estimate. They're parked at the end of the plan as Estimated — set real dates as you schedule them.`
    );
    router.refresh();
  }

  async function handleAddPhase(formData: FormData) {
    setSaving(true);
    setMutationError(null);
    const supabase = createClient();

    const name = formData.get("name") as string;
    const startDate = formData.get("start_date") as string;
    const endDate = formData.get("end_date") as string || startDate;
    const lineItemId = formData.get("estimate_line_item_id") as string;
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
        estimate_line_item_id: lineItemId || null,
        assigned_employee_ids: Array.from(addAssignees),
        created_by: userId,
      })
      .select("*")
      .single();

    if (!error && data) {
      setPhases((prev) => [...prev, data]);
      setShowAdd(false);
      setAddAssignees(new Set());
      setExpandedId(data.id);
    } else {
      setMutationError(error?.message || "Could not add this phase.");
    }
    setSaving(false);
  }

  async function handleUpdateStatus(phaseId: string, newStatus: string) {
    setMutationError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("schedule_phases")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", phaseId);
    if (error) {
      setMutationError(error.message);
      return false;
    }
    setPhases((prev) =>
      prev.map((p) => (p.id === phaseId ? { ...p, status: newStatus } : p))
    );
  }

  // Confirm = put the phase LIVE. It shows up on the /schedule calendar and
  // the crew app, and everyone assigned gets a "you're scheduled" email (CC
  // office). Requires a person + a budget line — the server enforces it.
  // Toggling off reverts to a tentative plan item.
  async function handleToggleConfirm(
    phaseId: string,
    currentlyConfirmed: boolean,
    confirmedWithName?: string,
  ) {
    setMutationError(null);
    setNotifyResult(null);
    const res = await setPhaseConfirmation(
      phaseId,
      projectId,
      !currentlyConfirmed,
      confirmedWithName ?? null,
    );
    if (res.error) {
      setMutationError(res.error);
      return false;
    }
    setPhases((prev) =>
      prev.map((p) =>
        p.id === phaseId
          ? {
              ...p,
              is_confirmed: !currentlyConfirmed,
              confirmed_with: currentlyConfirmed ? null : confirmedWithName?.trim() || null,
            }
          : p,
      ),
    );
    if (res.notify) setNotifyResult(res.notify);
    return true;
  }

  async function handleUpdatePhase(
    phaseId: string,
    patch: { name: string; start_date: string; end_date: string; notes: string | null; assigned_employee_ids: string[] },
  ) {
    setMutationError(null);
    setNotifyResult(null);
    const res = await updateSchedulePhase(phaseId, {
      project_id: projectId,
      name: patch.name,
      start_date: patch.start_date,
      end_date: patch.end_date,
      notes: patch.notes ?? "",
      assigned_employee_ids: patch.assigned_employee_ids,
    });
    if (res.error) {
      setMutationError(res.error);
      return;
    }
    setPhases((prev) =>
      prev.map((p) => (p.id === phaseId ? { ...p, ...patch } : p))
    );
    if (res.notify) setNotifyResult(res.notify);
    setEditingId(null);
  }

  async function handleDelete(phaseId: string) {
    const phase = phases.find((item) => item.id === phaseId);
    if (!window.confirm(`Delete "${phase?.name || "this phase"}"? This cannot be undone.`)) {
      return;
    }
    setMutationError(null);
    const supabase = createClient();
    const { error } = await supabase.from("schedule_phases").delete().eq("id", phaseId);
    if (error) {
      setMutationError(error.message);
      return;
    }
    setPhases((prev) => prev.filter((p) => p.id !== phaseId));
  }

  async function handleUpdateLineItem(phaseId: string, lineItemId: string) {
    setMutationError(null);
    const supabase = createClient();
    const value = lineItemId || null;
    const { error } = await supabase
      .from("schedule_phases")
      .update({ estimate_line_item_id: value, updated_at: new Date().toISOString() })
      .eq("id", phaseId);
    if (error) {
      setMutationError(error.message);
      return;
    }
    setPhases((prev) =>
      prev.map((p) => (p.id === phaseId ? { ...p, estimate_line_item_id: value } : p))
    );
  }

  // Live cascade: where every phase actually lands once confirmed slips ripple
  // through. Confirmed/started phases keep their dates; unconfirmed ones slide.
  const cascadeMap = useMemo(
    () => cascadeSchedule(phases.filter((p) => p.phase_scope !== "daily") as unknown as CascadeInput[]),
    [phases]
  );

  // Sequence check: nothing links one phase to another, so the trade order is
  // only as good as the last person who typed a date. This reads it back.
  const sequenceIssues = useMemo(() => checkSequence(phases as SequencePhase[]), [phases]);
  const issueMap = useMemo(() => issuesByPhase(sequenceIssues), [sequenceIssues]);
  const conflictCount = sequenceIssues.filter((i) => i.severity === "conflict").length;
  const warningCount = sequenceIssues.length - conflictCount;

  /** Every route into a phase — Gantt bar, issue row — lands on its list card. */
  function openPhase(id: string) {
    setView("list");
    setExpandedId(id);
    setTimeout(() => {
      document.getElementById(`phase-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
              <Calendar className="h-5 w-5 text-amber-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Project Schedule</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {totalPhases === 0
                  ? "Build the job in the order the work needs to happen"
                  : `${totalPhases - completedPhases} active · ${completedPhases} done`}
                {overduePhases > 0 && (
                  <span className="ml-1 text-red-400">· {overduePhases} overdue</span>
                )}
              </p>
            </div>
            {totalPhases > 0 && (
              <div className="text-right">
                <p className="text-lg font-semibold tabular-nums">{progress}%</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">complete</p>
              </div>
            )}
          </div>

          {totalPhases > 0 && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-px border-t bg-border">
          <button
            type="button"
            onClick={handleBuildFromEstimate}
            disabled={buildingPlan}
            className="flex h-11 items-center justify-center gap-2 bg-card text-sm font-medium text-sky-400 transition-colors hover:bg-muted/40 disabled:opacity-50"
          >
            {buildingPlan ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
            From Estimate
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAi(true);
              if (aiMessages.length === 0) {
                setAiInput(
                  phases.length === 0
                    ? `Plan the full construction schedule for ${projectName}. It's a ${projectType || "remodel"} project${projectDescription ? `: ${projectDescription}` : ""}. Create all the phases with dates starting next week.`
                    : ""
                );
              }
            }}
            className="flex h-11 items-center justify-center gap-2 bg-card text-sm font-medium text-violet-400 transition-colors hover:bg-muted/40"
          >
            <Bot className="h-4 w-4" />
            Plan with AI
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAdd(true);
              setAddAssignees(new Set());
            }}
            className="flex h-11 items-center justify-center gap-2 bg-card text-sm font-semibold text-amber-500 transition-colors hover:bg-muted/40"
          >
            <Plus className="h-4 w-4" />
            Add Phase
          </button>
        </div>
      </section>

      {mutationError && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {mutationError}
        </div>
      )}

      {buildResult && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-300">
          <p>{buildResult}</p>
          <button type="button" onClick={() => setBuildResult(null)} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
            Dismiss
          </button>
        </div>
      )}

      {notifyResult && (
        <div className="space-y-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              {notifyResult.emailed.length > 0 && (
                <p className="text-emerald-300">
                  Notified: {notifyResult.emailed.join(", ")}{" "}
                  <span className="text-emerald-400/70">(Jorge + Ryan cc&apos;d)</span>
                </p>
              )}
              {notifyResult.emailed.length === 0 && !notifyResult.error && notifyResult.skipped.length === 0 && (
                <p className="text-emerald-300">Phase is live. No one to notify yet.</p>
              )}
              {notifyResult.skipped.length > 0 && (
                <p className="text-amber-300">
                  No email on file — not notified: {notifyResult.skipped.join(", ")}. Add an
                  email on their employee/sub record.
                </p>
              )}
              {notifyResult.error && (
                <p className="text-amber-300">Heads up: {notifyResult.error}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setNotifyResult(null)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* AI Schedule Planner */}
      <BottomSheet open={showAi} onOpenChange={setShowAi}>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-violet-400" />
              Plan the schedule
            </BottomSheetTitle>
            <BottomSheetDescription>
              Describe the job and review every phase before adding it.
            </BottomSheetDescription>
          </BottomSheetHeader>
          <BottomSheetBody className="p-0">
          <div className="overflow-hidden bg-card">
          {/* Chat messages */}
          <div className="max-h-80 overflow-y-auto p-3 space-y-3">
            {aiMessages.length === 0 && !aiLoading && (
              <div className="text-center py-4 space-y-2">
                <Bot className="h-8 w-8 mx-auto text-violet-400 opacity-60" />
                <p className="text-xs text-muted-foreground">
                  Tell me about the project and I&apos;ll plan the schedule
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {[
                    `Plan the full schedule for ${projectName}`,
                    "What phases does a bathroom remodel need?",
                    "Add rough plumbing and electrical next week",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setAiInput(q); }}
                      className="text-[11px] px-2 py-1 rounded-full border border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {aiMessages.map((msg, i) => (
              <div key={i}>
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="bg-amber-600/20 border border-amber-600/30 rounded-xl px-3 py-2 max-w-[85%]">
                      <p className="text-sm">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Bot className="h-5 w-5 text-violet-400 shrink-0 mt-0.5" />
                      <div className="bg-muted/50 border rounded-xl px-3 py-2 max-w-[85%]">
                        <p className="text-sm whitespace-pre-wrap">{renderInlineMarkdown(msg.content)}</p>
                      </div>
                    </div>

                    {/* Proposed phases */}
                    {msg.proposedPhases && msg.proposedPhases.length > 0 && (
                      <div className="ml-7 space-y-1.5">
                        {msg.proposedPhases.map((p, j) => (
                          <div
                            key={j}
                            className="text-xs p-2 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-between"
                          >
                            <div>
                              <span className="font-medium">{p.name}</span>
                              <span className="text-muted-foreground ml-2">
                                {p.start_date} — {p.end_date}
                              </span>
                            </div>
                          </div>
                        ))}
                        <Button
                          size="sm"
                          onClick={() => handleAddAiPhases(msg.proposedPhases)}
                          disabled={addingPhases}
                          className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-xl"
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                          {addingPhases
                            ? "Adding..."
                            : `Add ${msg.proposedPhases.length} Phases to Schedule`}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {aiLoading && (
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-violet-400" />
                <div className="flex gap-1">
                  <div className="h-2 w-2 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
                  <div className="h-2 w-2 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
                  <div className="h-2 w-2 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t p-2 flex items-end gap-2">
            <textarea
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAiSend();
                }
              }}
              placeholder={isListening ? "Listening..." : "Tell me what to schedule..."}
              rows={1}
              disabled={aiLoading}
              className={`flex-1 min-h-[40px] max-h-[80px] resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${
                isListening ? "border-red-400 bg-red-950/20" : ""
              }`}
            />
            {isSupported && (
              <button
                onClick={() => isListening ? stopListening() : (setAiInput(""), startListening())}
                disabled={aiLoading}
                className={`shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${
                  isListening ? "bg-red-600 text-white animate-pulse" : "border text-muted-foreground hover:text-violet-400"
                }`}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <Button
              size="icon"
              onClick={handleAiSend}
              disabled={aiLoading || !aiInput.trim()}
              className="shrink-0 h-10 w-10 rounded-lg bg-violet-600 hover:bg-violet-700"
            >
              {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          </div>
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>

      {/* Add phase form */}
      <BottomSheet open={showAdd} onOpenChange={setShowAdd}>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle>Add schedule phase</BottomSheetTitle>
            <BottomSheetDescription>
              Add the next step in the order the job will be built.
            </BottomSheetDescription>
          </BottomSheetHeader>
          <BottomSheetBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAddPhase(new FormData(e.currentTarget));
          }}
          className="space-y-4"
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
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">
                Budget line item {lineItems.length === 0 && <span className="text-amber-500">· no estimate line items on this project yet</span>}
              </label>
              <select
                name="estimate_line_item_id"
                defaultValue=""
                disabled={lineItems.length === 0}
                className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">— None —</option>
                {lineItems.map((li) => (
                  <option key={li.id} value={li.id}>
                    {li.trade ? `[${li.trade}] ` : ""}{li.description}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Linking a budget line means daily logs on this phase show up against that line item — and roll up into actual cost vs. budget later.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Assign to</label>
              <div className="mt-1.5">
                <AssigneePicker
                  employees={employees}
                  selected={addAssignees}
                  onToggle={(id) => toggleSet(setAddAssignees, id)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Tap a name to assign or unassign. Workers see phases assigned to them in their Today&apos;s Work.
              </p>
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
        </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>

      <BottomSheet
        open={confirmPhaseId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmPhaseId(null);
            setConfirmedWith("");
          }
        }}
      >
        <BottomSheetContent maxHeight="65vh">
          <BottomSheetHeader>
            <BottomSheetTitle>Put this phase live</BottomSheetTitle>
            <BottomSheetDescription>
              Confirming publishes this phase to the live schedule and the crew app, and
              emails everyone assigned.
            </BottomSheetDescription>
          </BottomSheetHeader>
          <BottomSheetBody className="space-y-4">
            {(() => {
              const target = phases.find((phase) => phase.id === confirmPhaseId);
              const hasPeople =
                (target?.assigned_employee_ids?.length ?? 0) > 0 ||
                (target?.assigned_sub_ids?.length ?? 0) > 0;
              const hasBudgetLine = target?.estimate_line_item_id != null;
              const blocked = !hasPeople || !hasBudgetLine;
              return (
                <>
                  <div className="rounded-xl border bg-card px-3 py-3">
                    <p className="text-xs text-muted-foreground">Phase</p>
                    <p className="mt-0.5 text-sm font-semibold">{target?.name}</p>
                  </div>
                  {blocked && (
                    <div className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      <p className="font-semibold">A live phase needs:</p>
                      {!hasPeople && (
                        <p>• Someone attached — add a crew member (Edit) or sub before confirming.</p>
                      )}
                      {!hasBudgetLine && (
                        <p>• A budget line — pick one in the &quot;Budget line&quot; dropdown on the phase.</p>
                      )}
                    </div>
                  )}
                  <label className="block text-sm font-medium">
                    Confirmed with
                    <input
                      value={confirmedWith}
                      onChange={(event) => setConfirmedWith(event.target.value)}
                      placeholder="Subcontractor or crew name (optional)"
                      className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2.5 text-sm font-normal"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmPhaseId(null)}
                      disabled={confirmSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={confirmSaving || !confirmPhaseId || blocked}
                      onClick={async () => {
                        if (!confirmPhaseId) return;
                        setConfirmSaving(true);
                        const didConfirm = await handleToggleConfirm(confirmPhaseId, false, confirmedWith);
                        setConfirmSaving(false);
                        if (!didConfirm) return;
                        setConfirmPhaseId(null);
                        setConfirmedWith("");
                      }}
                    >
                      <Lock className="mr-1.5 h-4 w-4" />
                      {confirmSaving ? "Going live..." : "Confirm & go live"}
                    </Button>
                  </div>
                </>
              );
            })()}
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>

      {/* Short term — the crew's day plans this week (internal, never client-facing) */}
      {shortTerm.length > 0 && (
        <section className="rounded-2xl border bg-card p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-amber-500" />
              Short term — this week
            </h3>
            <span className="text-[11px] text-muted-foreground">crew days · internal only</span>
          </div>
          <div className="space-y-1.5">
            {shortTerm.map((p) => {
              const dayLabel =
                p.start_date === today
                  ? "Today"
                  : p.start_date === tomorrow
                    ? "Tomorrow"
                    : new Date(`${p.start_date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
              return (
                <div key={p.id} className="flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      p.start_date === today ? "bg-amber-500/15 text-amber-500" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {dayLabel}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  {(p.assigned_employee_ids?.length ?? 0) > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {p.assigned_employee_ids!.length}
                    </span>
                  )}
                  {p.status === "completed" && <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Phase list — the PLAN (master schedule, what the client sees) */}
      {masterPhases.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center text-muted-foreground">
          <Calendar className="mx-auto mb-3 h-9 w-9 opacity-40" />
          <p className="text-sm font-medium text-foreground">No schedule yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs">
            Add the first phase yourself or let AI draft the full construction sequence for review.
          </p>
        </div>
      ) : (
        <section>
          <div className="mb-3 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Schedule sequence</h3>
              <p className="text-xs text-muted-foreground">
                {view === "gantt" ? "Tap a bar to manage that phase" : "Tap a phase to manage it"}
                <span className="ml-1">· {totalPhases} phases</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-px overflow-hidden rounded-lg border">
              <button
                type="button"
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                className={`flex h-7 items-center gap-1.5 px-2.5 text-[11px] font-medium transition-colors ${
                  view === "list" ? "bg-amber-500/15 text-amber-500" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="h-3.5 w-3.5" />
                List
              </button>
              <button
                type="button"
                onClick={() => setView("gantt")}
                aria-pressed={view === "gantt"}
                className={`flex h-7 items-center gap-1.5 px-2.5 text-[11px] font-medium transition-colors ${
                  view === "gantt" ? "bg-amber-500/15 text-amber-500" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <GanttChartSquare className="h-3.5 w-3.5" />
                Gantt
              </button>
            </div>
          </div>

          {sequenceIssues.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-2xl border border-amber-500/40 bg-amber-500/5">
              <button
                type="button"
                onClick={() => setShowIssues((v) => !v)}
                aria-expanded={showIssues}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
              >
                <ShieldAlert className={`h-4 w-4 shrink-0 ${conflictCount > 0 ? "text-red-400" : "text-amber-500"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {conflictCount > 0
                      ? `${conflictCount} sequencing conflict${conflictCount === 1 ? "" : "s"}`
                      : `${warningCount} thing${warningCount === 1 ? "" : "s"} to check`}
                    {conflictCount > 0 && warningCount > 0 && (
                      <span className="font-normal text-muted-foreground"> · {warningCount} to check</span>
                    )}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Work scheduled out of order. Nothing has been moved.
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showIssues ? "rotate-180" : ""}`}
                />
              </button>
              {showIssues && (
                <ul className="space-y-px border-t border-amber-500/20 bg-card/40">
                  {[...sequenceIssues]
                    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "conflict" ? -1 : 1))
                    .map((issue, i) => (
                      <li key={`${issue.rule}-${issue.phaseId}-${i}`}>
                        <button
                          type="button"
                          onClick={() => openPhase(issue.phaseId)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                        >
                          <span
                            className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                              issue.severity === "conflict" ? "bg-red-400" : "bg-amber-500"
                            }`}
                          />
                          <span className="text-xs leading-relaxed">{issue.message}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {view === "gantt" && (
            <ScheduleGantt
              phases={masterPhases}
              cascade={cascadeMap}
              issues={issueMap}
              selectedId={expandedId}
              // The Gantt reads the plan; every edit control lives on the list card.
              onSelectPhase={openPhase}
            />
          )}

          <div className={view === "gantt" ? "hidden" : "space-y-0"}>
          {[...masterPhases]
            .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.sort_order - b.sort_order)
            .map((phase, index, ordered) => {
              const status = STATUS_CONFIG[phase.status] || STATUS_CONFIG.not_started;
              const isOverdue = phase.status !== "completed" && phase.end_date < today;
              const isEditing = editingId === phase.id;
              const isExpanded = expandedId === phase.id;
              const variance = phase.planned_end_date
                ? Math.round(
                    (new Date(phase.end_date).getTime() - new Date(phase.planned_end_date).getTime()) /
                      (1000 * 60 * 60 * 24)
                  )
                : 0;
              const start = new Date(`${phase.start_date}T00:00:00`);
              const end = new Date(`${phase.end_date}T00:00:00`);
              const cascaded = !phase.is_confirmed && phase.status === "not_started"
                ? cascadeMap.get(phase.id)
                : null;
              const phaseIssues: SequenceIssue[] = issueMap.get(phase.id) ?? [];
              const hasConflict = phaseIssues.some((i) => i.severity === "conflict");

              return (
                <div
                  key={phase.id}
                  id={`phase-${phase.id}`}
                  className="relative grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 pb-3 last:pb-0"
                >
                  {index < ordered.length - 1 && (
                    <div className="absolute bottom-0 left-[1.6rem] top-11 w-px bg-border" />
                  )}
                  <div className="relative z-10 flex h-11 flex-col items-center justify-center rounded-xl border bg-background">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {start.toLocaleDateString("en-US", { month: "short" })}
                    </span>
                    <span className="text-base font-bold leading-none tabular-nums">{start.getDate()}</span>
                  </div>

                  <div className={`overflow-hidden rounded-2xl border bg-card transition-colors ${
                    isOverdue ? "border-red-500/40" : isExpanded ? "border-amber-500/40" : ""
                  }`}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedId(isExpanded ? null : phase.id);
                        if (isExpanded) setEditingId(null);
                      }}
                      aria-expanded={isExpanded}
                      className="flex w-full items-start gap-3 p-3 text-left"
                    >
                      <span
                        className="mt-1 h-8 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: phase.color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{phase.name}</span>
                          {phase.event_type === "inspection" && (
                            <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                              Milestone
                            </span>
                          )}
                          {phase.is_confirmed && <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            {" – "}
                            {end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                          {(phase.assigned_employee_ids?.length ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {phase.assigned_employee_ids!.length}
                            </span>
                          )}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge className={`${status.color} border-0 text-[9px] text-white`}>
                            {status.label}
                          </Badge>
                          {isOverdue && (
                            <Badge className="border-0 bg-red-500 text-[9px] text-white">Overdue</Badge>
                          )}
                          {cascaded?.start_date && cascaded.start_date !== phase.start_date && (
                            <span className="text-[10px] font-medium text-amber-500">
                              shifts {cascaded.slip_days ? `+${cascaded.slip_days}d` : ""}
                            </span>
                          )}
                          {phaseIssues.length > 0 && (
                            <Badge
                              className={`border-0 text-[9px] text-white ${
                                hasConflict ? "bg-red-500" : "bg-amber-500"
                              }`}
                            >
                              {hasConflict ? "Out of order" : "Check"}
                              {phaseIssues.length > 1 ? ` ×${phaseIssues.length}` : ""}
                            </Badge>
                          )}
                        </span>
                      </span>
                      <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`} />
                    </button>

                    {isExpanded && (
                      <div className="space-y-4 border-t px-3 pb-3 pt-3">
                    {isEditing ? (
                      <form
                        className="space-y-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          handleUpdatePhase(phase.id, {
                            name: (fd.get("name") as string).trim(),
                            start_date: fd.get("start") as string,
                            end_date: fd.get("end") as string,
                            notes: ((fd.get("notes") as string) || "").trim() || null,
                            assigned_employee_ids: Array.from(editAssignees),
                          });
                        }}
                      >
                        <div>
                          <label className="text-xs text-muted-foreground">Phase name</label>
                          <input
                            name="name"
                            required
                            defaultValue={phase.name}
                            className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs text-muted-foreground">
                            Start
                            <input name="start" type="date" required defaultValue={phase.start_date} className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-xs" />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            End
                            <input name="end" type="date" required defaultValue={phase.end_date} className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-xs" />
                          </label>
                        </div>
                        <label className="block text-xs text-muted-foreground">
                          Notes
                          <textarea name="notes" defaultValue={phase.notes ?? ""} rows={2} className="mt-1 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm" />
                        </label>
                        <div>
                          <div className="mb-1.5 text-xs text-muted-foreground">Assign crew</div>
                          <AssigneePicker
                            employees={employees}
                            selected={editAssignees}
                            onToggle={(id) => toggleSet(setEditAssignees, id)}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                          <Button type="submit" size="sm" className="bg-amber-600 text-white hover:bg-amber-700">
                            Save changes
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <>
                        {phase.notes && (
                          <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{phase.notes}</p>
                        )}
                        {(phase.assigned_employee_ids?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Crew</span>
                            {phase.assigned_employee_ids!.map((eid) => {
                              const emp = employeesById.get(eid);
                              if (!emp) return null;
                              return (
                                <span
                                  key={eid}
                                  title={`${emp.first_name} ${emp.last_name}${emp.title ? ` · ${emp.title}` : ""}`}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border"
                                  style={{ background: `${colorFromId(eid)}22`, borderColor: `${colorFromId(eid)}55`, color: colorFromId(eid) }}
                                >
                                  <span
                                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                                    style={{ background: colorFromId(eid) }}
                                  >
                                    {employeeInitials(emp)}
                                  </span>
                                  {emp.first_name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {phase.is_confirmed && (
                          <div className="flex items-center gap-2 text-xs text-emerald-400">
                            <Lock className="h-3.5 w-3.5" />
                            Firm dates{phase.confirmed_with ? ` · confirmed with ${phase.confirmed_with}` : ""}
                          </div>
                        )}
                        {phaseIssues.length > 0 && (
                          <ul className={`space-y-1.5 rounded-lg border px-3 py-2 ${
                            hasConflict
                              ? "border-red-500/30 bg-red-500/10"
                              : "border-amber-500/20 bg-amber-500/10"
                          }`}>
                            {phaseIssues.map((issue, i) => (
                              <li key={`${issue.rule}-${i}`} className="flex items-start gap-2 text-xs">
                                <span
                                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                                    issue.severity === "conflict" ? "bg-red-400" : "bg-amber-500"
                                  }`}
                                />
                                <span className={issue.severity === "conflict" ? "text-red-300" : "text-amber-400"}>
                                  {issue.message}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {cascaded?.start_date && cascaded.start_date !== phase.start_date && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                            Based on earlier work, this phase may move to{" "}
                            {new Date(`${cascaded.start_date}T00:00:00`).toLocaleDateString()} –{" "}
                            {new Date(`${cascaded.end_date || cascaded.start_date}T00:00:00`).toLocaleDateString()}.
                          </div>
                        )}
                        {variance !== 0 && (
                          <p className={`text-xs font-medium ${variance > 0 ? "text-red-400" : "text-emerald-400"}`}>
                            {variance > 0 ? `${variance} days behind the original plan` : `${Math.abs(variance)} days ahead of the original plan`}
                          </p>
                        )}
                      </>
                    )}

                    {!isEditing && lineItems.length > 0 && (
                      <label className="block text-xs text-muted-foreground">
                        Budget line
                        <select
                          value={phase.estimate_line_item_id ?? ""}
                          onChange={(e) => handleUpdateLineItem(phase.id, e.target.value)}
                          className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                        >
                          <option value="">— None —</option>
                          {lineItems.map((li) => (
                            <option key={li.id} value={li.id}>
                              {li.trade ? `[${li.trade}] ` : ""}{li.description}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {!isEditing && (
                      <>
                        <label className="block text-xs text-muted-foreground">
                          Status
                          <select
                            value={phase.status}
                            onChange={(e) => handleUpdateStatus(phase.id, e.target.value)}
                            className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                          >
                            <option value="not_started">Not Started</option>
                            <option value="in_progress">In Progress</option>
                            <option value="completed">Done</option>
                            <option value="on_hold">On Hold</option>
                          </select>
                        </label>
                        <div className="grid grid-cols-3 gap-2 border-t pt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (phase.is_confirmed) {
                                handleToggleConfirm(phase.id, true);
                              } else {
                                setConfirmPhaseId(phase.id);
                                setConfirmedWith("");
                              }
                            }}
                            className={phase.is_confirmed ? "text-emerald-400" : ""}
                          >
                            <Lock className="mr-1.5 h-3.5 w-3.5" />
                            {phase.is_confirmed ? "Unlock" : "Confirm"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => startEditing(phase)}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleDelete(phase.id)} className="text-red-400 hover:text-red-300">
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Delete
                          </Button>
                        </div>
                      </>
                    )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
